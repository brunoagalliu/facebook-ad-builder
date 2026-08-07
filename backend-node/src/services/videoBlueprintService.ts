/**
 * Stage 4: video-native blueprint deconstruction via Gemini's video understanding —
 * the counterpart to adRemixService.ts's deconstructTemplate, but for video ads
 * instead of static images. Separate service (not a branch inside adRemixService.ts)
 * because the model, prompt, and output schema are all genuinely different, mirroring
 * how videoGenerationService.ts already stands apart from imageGenerationService.ts.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

import { settings } from "../core/config";
import { VIDEO_DECONSTRUCTION_PROMPT } from "../prompts/videoBlueprintPrompts";
import { VideoBlueprint, videoBlueprintSchema } from "../schemas/videoBlueprint";
import { extractJsonFromText } from "../utils/json";

const MODEL = "gemini-flash-latest";

// Gemini's inline generateContent request must stay under ~20MB total; base64 adds
// ~33% overhead, so the raw file needs real headroom under that. Our own
// Seedance-generated clips (4-15s, 720p) are comfortably a few MB — this only bites
// on longer/larger scraped competitor videos, where the fix would be Gemini's
// separate Files API (upload-then-reference), not attempted here.
const MAX_INLINE_VIDEO_BYTES = 15 * 1024 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

function getClient(): GoogleGenerativeAI {
  if (!settings.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }
  return new GoogleGenerativeAI(settings.GEMINI_API_KEY);
}

async function fetchVideoAsBase64(videoUrl: string): Promise<{ mimeType: string; data: string }> {
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch video: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_INLINE_VIDEO_BYTES) {
    throw new Error(
      `Video is ${(buffer.length / 1024 / 1024).toFixed(1)}MB, over the ${MAX_INLINE_VIDEO_BYTES / 1024 / 1024}MB limit for inline analysis`
    );
  }

  const ext = videoUrl.toLowerCase().match(/\.(mp4|webm|mov)(\?|$)/)?.[1];
  const mimeType = (ext && MIME_BY_EXT[`.${ext}`]) ?? response.headers.get("content-type") ?? "video/mp4";
  return { mimeType, data: buffer.toString("base64") };
}

export async function deconstructVideoTemplate(videoUrl: string): Promise<VideoBlueprint> {
  try {
    const model = getClient().getGenerativeModel({ model: MODEL });
    const { mimeType, data } = await fetchVideoAsBase64(videoUrl);

    const result = await model.generateContent([VIDEO_DECONSTRUCTION_PROMPT, { inlineData: { mimeType, data } }]);
    const blueprintData = extractJsonFromText(result.response.text());
    return videoBlueprintSchema.parse(blueprintData);
  } catch (err) {
    throw new Error(`Failed to deconstruct video template: ${(err as Error).message}`);
  }
}
