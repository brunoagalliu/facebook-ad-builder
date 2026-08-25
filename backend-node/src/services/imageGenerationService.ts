/**
 * Ports the image-generation logic from backend/app/api/v1/generated_ads.py:
 * build_comprehensive_prompt, download_and_save_image, and the model-selection
 * branching in generate_image (with a mock/placeholder fallback when neither provider
 * is configured or a generation call fails).
 *
 * nano-banana-pro (the default model) generates via Kie.ai's jobs API rather than
 * Fal.ai — same createTask/recordInfo pattern videoGenerationService.ts already uses
 * for Seedance, confirmed against kie.ai's own Nano Banana Pro API reference — because
 * it's 40-60% cheaper for an identical model (Kie's own pricing table cites Fal as the
 * reference price it's undercutting) and covers text-to-image and image-to-image/edit
 * through the same endpoint (image_input populated vs. empty), unlike Fal's separate
 * nano-banana-pro/edit SKU. Fal.ai stays wired up for the "imagen4" option (Kie parity
 * unverified) and as an automatic fallback if KIE_AI_API_KEY isn't configured.
 */
import { fal } from "@fal-ai/client";
import { randomUUID } from "crypto";

import { settings } from "../core/config";
import { ImageGenerationRequestInput } from "../schemas/generatedAd";
import { uploadToLocal } from "./storage";

const KIE_BASE_URL = "https://api.kie.ai/api/v1/jobs";
const KIE_POLL_INTERVAL_MS = 3000;
const KIE_POLL_TIMEOUT_MS = 120_000;
const KIE_ASPECT_RATIOS = new Set(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "auto"]);

interface KieCreateTaskResponse {
  code: number;
  msg: string;
  data?: { taskId: string };
}

interface KieRecordInfoResponse {
  code: number;
  msg: string;
  data?: {
    state: "waiting" | "queuing" | "generating" | "success" | "fail";
    resultJson?: string;
    failMsg?: string;
  };
}

/** Runs one nano-banana-pro generation to completion via Kie.ai and returns the
 * (ephemeral, ~24h) result URL — caller downloads it immediately, same as the Fal.ai
 * path and videoGenerationService.ts's downloadAndSaveVideo. */
async function generateViaKie(prompt: string, aspectRatio: string, resolution: string, imageInput: string[]): Promise<string> {
  const response = await fetch(`${KIE_BASE_URL}/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.KIE_AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "nano-banana-pro",
      input: {
        prompt,
        image_input: imageInput,
        aspect_ratio: KIE_ASPECT_RATIOS.has(aspectRatio) ? aspectRatio : "1:1",
        resolution: ["1K", "2K", "4K"].includes(resolution) ? resolution : "1K",
        output_format: "png",
      },
    }),
  });
  const data = (await response.json()) as KieCreateTaskResponse;
  if (!response.ok || data.code !== 200 || !data.data?.taskId) {
    throw new Error(data.msg || `Kie.ai createTask failed with status ${response.status}`);
  }

  const taskId = data.data.taskId;
  const deadline = Date.now() + KIE_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, KIE_POLL_INTERVAL_MS));

    const statusResponse = await fetch(`${KIE_BASE_URL}/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${settings.KIE_AI_API_KEY}` },
    });
    const statusData = (await statusResponse.json()) as KieRecordInfoResponse;
    if (!statusResponse.ok || statusData.code !== 200 || !statusData.data) {
      throw new Error(statusData.msg || `Kie.ai recordInfo failed with status ${statusResponse.status}`);
    }

    const { state, resultJson, failMsg } = statusData.data;
    if (state === "success" && resultJson) {
      const parsed = JSON.parse(resultJson) as { resultUrls?: string[] };
      const resultUrl = parsed.resultUrls?.[0];
      if (!resultUrl) throw new Error("Kie.ai task succeeded but returned no result URL");
      return resultUrl;
    }
    if (state === "fail") {
      throw new Error(failMsg || "Kie.ai image generation failed");
    }
  }
  throw new Error("Kie.ai image generation timed out");
}

// Distilled from a course on AI UGC ad production — see
// knowledge/direct_response/21_hook_iteration_from_reference.md and
// videoGenerationService.ts for the same source material applied elsewhere.
// Preserves the real product's label/packaging exactly rather than letting the model
// reinterpret it — aimed at a known Fal.ai failure mode (redrawn/distorted labels)
// when a real product photo is supplied via the nano-banana-pro/edit path.
const PRODUCT_FIDELITY_CLAUSE =
  "All product typography, proportions, and artwork must remain pixel-perfect to the uploaded reference image with no redesign, recolor, or artistic reinterpretation";

// Adapted for still images from the "Universal Quality Control Negatives" list that
// appears in every worked example of the source material — the "7 things that scream
// AI" (floating products, too-perfect lighting, distorted hands, etc), minus the
// video-only terms (audio sync, camera shake) that don't apply to a static image.
const QUALITY_CONTROL_NEGATIVES_CLAUSE =
  "Avoid: watermark, text overlays, logo artifacts, distorted or unrealistic proportions, distorted hands, floating or unanchored product, artificial oversaturation, cartoon effects, low-resolution artifacts";

export function buildComprehensivePrompt(request: ImageGenerationRequestInput): string {
  if (request.customPrompt) return request.customPrompt;

  const brand = (request.brand ?? {}) as Record<string, unknown>;
  const product = (request.product ?? {}) as Record<string, unknown>;
  const template = (request.template ?? {}) as Record<string, unknown>;
  const copy = (request.copy ?? {}) as Record<string, unknown>;

  const productName = (product.name as string) ?? "Product";
  const productDesc = (product.description as string) ?? "";
  const brandName = (brand.name as string) ?? "";
  const brandVoice = (brand.voice as string) ?? "Professional";
  const brandColors = (brand.colors as Record<string, string>) ?? {};
  const brandColor = brandColors.primary ?? "";

  const mood = (template.mood as string) ?? "Engaging";
  const lighting = (template.lighting as string) ?? "Professional lighting";
  const composition = (template.composition as string) ?? "Balanced";
  const designStyle = (template.design_style as string) ?? "Modern";

  const parts = [
    `Product Photography of ${productName}`,
    productDesc ? `- ${productDesc}` : "",
    brandName ? `${brandName} style: ${brandVoice}` : `Style: ${brandVoice}`,
    brandColor ? `Primary Color: ${brandColor}` : "",
  ];

  if (copy.headline) {
    parts.push(`Context: Visual representation of "${copy.headline}"`);
  }

  parts.push(`Art Direction: ${mood}, ${lighting}, ${composition}, ${designStyle}`);
  parts.push("High quality, photorealistic, 4k, advertising standard");

  // A WinningAd's Gemini-deconstructed blueprint (winnerPromotionService.ts or the
  // manual Ad Remix /deconstruct flow) — layout/visual-style guidance the wizard's
  // template selection already carries into this request, but which nothing actually
  // read until now.
  const blueprint = template.blueprint_json as
    | { layout_framework?: string; visual_style_guide?: string; psychological_triggers?: string[] }
    | undefined;
  if (blueprint?.layout_framework) {
    parts.push(`Layout: ${blueprint.layout_framework}`);
  }
  if (blueprint?.visual_style_guide) {
    parts.push(`Visual Style Reference: ${blueprint.visual_style_guide}`);
  }
  if (blueprint?.psychological_triggers?.length) {
    parts.push(`Evoke: ${blueprint.psychological_triggers.join(", ")}`);
  }

  if (request.useProductImage && request.productShots.length > 0) {
    parts.push(PRODUCT_FIDELITY_CLAUSE);
  }
  parts.push(QUALITY_CONTROL_NEGATIVES_CLAUSE);

  return parts.filter(Boolean).join(". ");
}

export async function downloadAndSaveImage(imageUrl: string, prefix = "generated"): Promise<string> {
  try {
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());

    const filename = `${prefix}_${randomUUID()}.png`;
    return await uploadToLocal(buffer, filename);
  } catch (err) {
    console.error("Error downloading image:", err);
    return imageUrl;
  }
}

export interface GeneratedImage {
  url: string;
  size: string;
  dimensions: string;
  prompt: string;
  error?: string;
}

/** Fal's ApiError shape carries the real cause in `body.detail` (e.g. "User is locked.
 * Reason: Exhausted balance...") — falling back to err.message loses that entirely. */
function extractFalErrorMessage(err: unknown): string {
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as { body?: { detail?: string } }).body;
    if (body?.detail) return body.detail;
  }
  if (err instanceof Error) return err.message;
  return "Image generation failed";
}

export async function generateImages(request: ImageGenerationRequestInput): Promise<GeneratedImage[]> {
  const images: GeneratedImage[] = [];
  const useKie = Boolean(settings.KIE_AI_API_KEY) && request.model !== "imagen4";
  const useFal = Boolean(settings.FAL_AI_API_KEY);

  if (useFal) {
    fal.config({ credentials: settings.FAL_AI_API_KEY });
  }

  for (let i = 0; i < request.count; i++) {
    for (const size of request.imageSizes) {
      const width = (size.width as number) ?? 1080;
      const height = (size.height as number) ?? 1080;
      const sizeName = (size.name as string) ?? "Square";
      const aspectRatio = (size.aspectRatio as string) ?? "1:1";

      const prompt = buildComprehensivePrompt(request);
      const imageInput = request.useProductImage && request.productShots.length > 0 ? request.productShots : [];

      if (useKie) {
        try {
          const externalUrl = await generateViaKie(prompt, aspectRatio, request.resolution, imageInput);
          const imageUrl = await downloadAndSaveImage(externalUrl, "generated");
          images.push({ url: imageUrl, size: sizeName, dimensions: `${width}x${height}`, prompt });
        } catch (err) {
          console.error("Kie.ai generation failed:", err);
          images.push({
            url: "",
            size: sizeName,
            dimensions: `${width}x${height}`,
            prompt,
            error: err instanceof Error ? err.message : "Image generation failed",
          });
        }
      } else if (useFal) {
        try {
          let modelId: string;
          let args: Record<string, unknown>;

          if (imageInput.length > 0) {
            modelId = "fal-ai/nano-banana-pro/edit";
            args = {
              prompt,
              image_urls: imageInput,
              aspect_ratio: `${width}:${height}`,
              output_format: "png",
            };
          } else {
            modelId = request.model === "imagen4" ? "fal-ai/imagen4/preview" : "fal-ai/nano-banana-pro";
            args = { prompt, image_size: { width, height } };
          }

          const result = await fal.subscribe(modelId as never, { input: args as never });
          const data = result.data as { images: { url: string }[] };
          const externalUrl = data.images[0].url;
          const imageUrl = await downloadAndSaveImage(externalUrl, "generated");
          images.push({ url: imageUrl, size: sizeName, dimensions: `${width}x${height}`, prompt });
        } catch (err) {
          console.error("Fal.ai generation failed:", err);
          images.push({
            url: "",
            size: sizeName,
            dimensions: `${width}x${height}`,
            prompt,
            error: extractFalErrorMessage(err),
          });
        }
      } else {
        const productName = (request.product?.name as string) ?? "Product";
        const imageUrl = `https://placehold.co/${width}x${height}/png?text=${encodeURIComponent(productName)}+${i + 1}`;
        images.push({ url: imageUrl, size: sizeName, dimensions: `${width}x${height}`, prompt });
      }
    }
  }

  // A total failure (every image errored) is a real request failure, not a partial
  // result — let it propagate as an error instead of returning a fake "success" full
  // of unusable placeholder images.
  if (images.length > 0 && images.every((img) => img.error)) {
    throw new Error(images[0].error);
  }

  return images;
}
