/**
 * AI UGC video generation via Kie.ai's Bytedance Seedance 2.0 model. The prompt
 * structure (iPhone-selfie framing, cinematography boilerplate, UGC authenticity
 * keywords, quality-control negative list, and the "reference a proven winner, then
 * iterate" character/product fidelity approach) is distilled from a course on AI UGC
 * ad production — see knowledge/direct_response/21_hook_iteration_from_reference.md
 * for the text-copy analogue of the same "iterate on proven references" principle.
 *
 * Originally built against Kie.ai's Sora-2-pro-storyboard model, which turned out to
 * be paused platform-wide (Kie.ai returned "This interface is temporarily paused" on
 * every Sora 2 variant, confirmed with a live account that had valid credits) — this
 * lines up with OpenAI's official Sora API sunset (Sept 24, 2026). Switched to
 * Bytedance Seedance 2.0 instead: no known sunset, cheaper per second, and its
 * `reference_image_urls`/`reference_audio_urls` fields are a *better* consistency
 * mechanism than Sora's free-text-description-or-character-tag approach — upload a
 * real photo/voice sample and it's used directly, rather than described in prose.
 *
 * API contract (confirmed empirically against the live API with a real account, and
 * against the model's own parameter schema embedded in kie.ai/seedance-2-0's page
 * data — docs.kie.ai's per-model pages return 404/403 to non-browser fetches):
 *   POST https://api.kie.ai/api/v1/jobs/createTask
 *     Authorization: Bearer <KIE_AI_API_KEY>, body { model, input }
 *     input: { prompt, duration (4-15s), aspect_ratio, resolution, generate_audio,
 *              reference_image_urls? }
 *     -> { code, msg, data: { taskId } }
 *   GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=...
 *     -> { data: { state: "waiting"|"queuing"|"generating"|"success"|"fail",
 *                  progress?, resultJson? (JSON string containing resultUrls[]),
 *                  failMsg? } }
 * Result URLs expire 24h after completion, so a successful poll must download and
 * persist the video immediately — mirrors downloadAndSaveImage's same constraint for
 * Fal.ai's image URLs in imageGenerationService.ts.
 */
import { randomUUID } from "crypto";

import { settings } from "../core/config";
import { CharacterInput, VideoGenerationRequestInput } from "../schemas/videoGeneration";
import { selectBlueprintForBrand, selectVideoBlueprintForBrand } from "./blueprintSelectionService";
import { uploadFile } from "./storage";

// Covers both blueprint shapes this can be fed: a real video blueprint
// (videoBlueprintService.ts — hook_type/pacing_and_cuts/cinematography_style/
// authenticity_signals) when one exists for the brand's vertical, or the older
// text-level fallback pulled from an image blueprint's narrative_arc/
// psychological_triggers (stage 3) when it doesn't. createVideoTask prefers the
// former since it's genuinely video-native, not adapted from image composition.
interface VideoBlueprintInsight {
  narrative_arc?: string;
  psychological_triggers?: string[];
  hook_type?: string;
  pacing_and_cuts?: string;
  cinematography_style?: string;
  authenticity_signals?: string[];
}

const KIE_BASE_URL = "https://api.kie.ai/api/v1/jobs";
const MODEL = "bytedance/seedance-2";
const MIN_DURATION = 4;
const MAX_DURATION = 15;

// Matches the "UGC Authenticity Keywords" / "Universal Quality Control Negatives"
// blocks present verbatim in every worked example in the course material — these
// are what keep the output from reading as AI-generated (the "7 things that scream
// AI": dead eyes, floating products, too-perfect lighting, robot hands, etc).
const UGC_AUTHENTICITY_KEYWORDS =
  "smartphone selfie, handheld realism, influencer-style monologue, direct-to-camera, authentic recommendation, conversational delivery, raw unfiltered TikTok aesthetic, real voice, authentic performance, micro hand jitters, single continuous take, unedited";

const QUALITY_CONTROL_NEGATIVES =
  "subtitles, captions, watermark, text overlays, words on screen, logo, branding, poor lighting, blurry footage, low resolution, artifacts, unwanted objects, inconsistent character appearance, amateur quality, cartoon effects, unrealistic proportions, distorted hands, artificial lighting, oversaturation, compression noise, camera shake";

/** Preserves the real product's label/packaging exactly rather than letting the
 * model reinterpret it — the single most repeated instruction across the course's
 * product-reference prompts ("pixel-perfect to img1... no redesign, recolor, or
 * artistic reinterpretation"). Seedance also takes the actual image via
 * reference_image_urls, but the text reinforces intent for what it should render. */
const PRODUCT_FIDELITY_CLAUSE =
  "All product typography, proportions, and artwork must remain pixel-perfect to the reference image with no redesign, recolor, or artistic reinterpretation.";

function buildCharacterClause(character?: CharacterInput): string {
  if (!character) return "Character: an authentic, relatable person filmed in natural UGC style";
  const bits = [character.age, character.ethnicity, character.gender].filter(Boolean).join(" ");
  const base = character.name ? `${character.name}, a ${bits}`.trim() : `a ${bits}`.trim();
  return `Character: ${base}${character.description ? ` with ${character.description}` : ""}`.trim();
}

/** Seedance takes one prompt per call (no multi-shot/storyboard API) — scenes are
 * concatenated into a single continuous take, each introduced as its own beat rather
 * than described as physically separate shots.
 *
 * blueprintInsight comes from a WinningAd auto-selected for the brand's vertical
 * (blueprintSelectionService.ts) — its narrative_arc/psychological_triggers are
 * text-level, so they translate to a video script; its layout_framework/
 * visual_style_guide (image composition) deliberately don't, since a UGC selfie
 * video follows a different visual grammar than a static ad image. Full video-native
 * blueprint extraction is a later stage, not attempted here. */
export function buildVideoPrompt(
  request: VideoGenerationRequestInput,
  blueprintInsight?: VideoBlueprintInsight
): string {
  if (request.customPrompt) return request.customPrompt;

  const hasProductRef = request.productShots.length > 0;
  const location = request.location || "a cozy, well-lit home setting";
  const filename = `IMG_${Math.floor(1000 + Math.random() * 9000)}.MOV`;
  const characterClause = buildCharacterClause(request.character);
  const actions = request.scenes.map((s) => s.action).join("\n");

  const inspirationParts = [
    blueprintInsight?.hook_type ? `structure the opening 2-3 seconds as a "${blueprintInsight.hook_type}" hook` : "",
    blueprintInsight?.narrative_arc ? `narrative arc: ${blueprintInsight.narrative_arc}` : "",
    blueprintInsight?.psychological_triggers?.length
      ? `emotional triggers to evoke: ${blueprintInsight.psychological_triggers.join(", ")}`
      : "",
  ].filter(Boolean);

  const cinematographyLine = [
    "Cinematography: Camera Shot: Medium close-up, slightly high angle, mostly stable framing with a slight gentle drift. Lens & DOF: IPHONE 15 PRO front camera (~24mm), no depth of field. Camera Motion: Subtle, natural handheld sway. Lighting: Bright, soft natural light. Color & Grade: neutral warm daylight palette with accurate, natural skin texture; no filters applied.",
    blueprintInsight?.cinematography_style ? `Reference shooting style from a proven winner in this niche: ${blueprintInsight.cinematography_style}` : "",
    blueprintInsight?.pacing_and_cuts ? `Pacing: ${blueprintInsight.pacing_and_cuts}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const authenticityKeywords = [UGC_AUTHENTICITY_KEYWORDS, ...(blueprintInsight?.authenticity_signals ?? [])].join(", ");

  const parts = [
    `A casual, selfie-style IPHONE 15 PRO front-camera vertical video (9:16) filmed in ${location}, titled "${filename}".`,
    characterClause,
    hasProductRef ? PRODUCT_FIDELITY_CLAUSE : "",
    cinematographyLine,
    inspirationParts.length ? `Creative Inspiration (from research on what's winning in this niche): ${inspirationParts.join("; ")}.` : "",
    `Actions:\n${actions}`,
    "Pacing directive: The character begins speaking within the first second — no silent pause, no settling-in beat, no dead air before dialogue starts. Deliver every line at a natural, energetic conversational pace, not slow or deliberate — this is a fast-paced short-form hook, every second counts.",
    "Audio & Ambience: Crisp, clear voice with natural room tone. No music, no cuts; one continuous take.",
    `UGC Authenticity Keywords: ${authenticityKeywords}.`,
    `Universal Quality Control Negatives: ${QUALITY_CONTROL_NEGATIVES}.`,
  ];

  return parts.filter(Boolean).join("\n\n");
}

function buildAspectRatio(aspectRatio: VideoGenerationRequestInput["aspectRatio"]): string {
  return aspectRatio === "landscape" ? "16:9" : "9:16";
}

function clampDuration(totalSeconds: number): number {
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, totalSeconds));
}

/** Prefers a real video-native blueprint (stage 4) for the brand's vertical; falls
 * back to the text-level insight extractable from an image blueprint (stage 3) when
 * no video blueprint has been promoted for that vertical yet. */
async function selectBestVideoInsight(brandId: string): Promise<VideoBlueprintInsight | undefined> {
  const videoBlueprint = await selectVideoBlueprintForBrand(brandId);
  if (videoBlueprint?.videoBlueprintJson) {
    return videoBlueprint.videoBlueprintJson as VideoBlueprintInsight;
  }
  const imageBlueprint = await selectBlueprintForBrand(brandId);
  return imageBlueprint?.blueprintJson as VideoBlueprintInsight | undefined;
}

interface CreateTaskResponse {
  code: number;
  msg: string;
  data?: { taskId: string };
}

export async function createVideoTask(request: VideoGenerationRequestInput): Promise<string> {
  if (!settings.KIE_AI_API_KEY) {
    throw new Error("KIE_AI_API_KEY not configured");
  }

  const totalDuration = request.scenes.reduce((sum, s) => sum + s.durationSeconds, 0);

  const brandId = (request.brand as Record<string, unknown> | undefined)?.id as string | undefined;
  const blueprintInsight = brandId ? await selectBestVideoInsight(brandId) : undefined;

  const input: Record<string, unknown> = {
    prompt: buildVideoPrompt(request, blueprintInsight),
    duration: clampDuration(totalDuration),
    aspect_ratio: buildAspectRatio(request.aspectRatio),
    resolution: request.resolution,
    generate_audio: true,
  };
  if (request.productShots.length > 0) {
    input.reference_image_urls = request.productShots;
  }

  const response = await fetch(`${KIE_BASE_URL}/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.KIE_AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, input }),
  });

  const data = (await response.json()) as CreateTaskResponse;
  if (!response.ok || data.code !== 200 || !data.data?.taskId) {
    throw new Error(data.msg || `Kie.ai createTask failed with status ${response.status}`);
  }
  return data.data.taskId;
}

export interface VideoTaskStatus {
  state: "waiting" | "queuing" | "generating" | "success" | "fail";
  progress?: number;
  resultUrl?: string;
  failMsg?: string;
}

interface RecordInfoResponse {
  code: number;
  msg: string;
  data?: {
    state: VideoTaskStatus["state"];
    progress?: number;
    resultJson?: string;
    failMsg?: string;
  };
}

export async function getVideoTaskStatus(taskId: string): Promise<VideoTaskStatus> {
  const response = await fetch(`${KIE_BASE_URL}/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${settings.KIE_AI_API_KEY}` },
  });
  const data = (await response.json()) as RecordInfoResponse;
  if (!response.ok || data.code !== 200 || !data.data) {
    throw new Error(data.msg || `Kie.ai recordInfo failed with status ${response.status}`);
  }

  const { state, progress, resultJson, failMsg } = data.data;
  if (state === "success" && resultJson) {
    const parsed = JSON.parse(resultJson) as { resultUrls?: string[] };
    return { state, progress, resultUrl: parsed.resultUrls?.[0] };
  }
  return { state, progress, failMsg };
}

/** Kie.ai's result URLs expire 24h after task completion — download immediately
 * rather than storing the ephemeral URL, mirroring downloadAndSaveImage. */
export async function downloadAndSaveVideo(videoUrl: string): Promise<string> {
  const response = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Failed to download video: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const filename = `generated_${randomUUID()}.mp4`;
  return uploadFile(buffer, filename, "video/mp4");
}
