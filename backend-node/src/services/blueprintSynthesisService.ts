/**
 * "Whole vertical" ad-generation mode: instead of auto-picking one random blueprint
 * from a vertical's pool (blueprintSelectionService.ts's existing behavior) or a user
 * manually picking one specific ad, synthesize a single meta-blueprint that captures
 * the patterns recurring across the whole pool. The synthesized object is shaped
 * exactly like a normal AdBlueprint/VideoBlueprint, so it flows through the existing
 * single-blueprint generation code (reconstructAd, buildVideoPrompt,
 * imageGenerationService.ts's blueprint flattening) completely unchanged — only the
 * routes decide which function produced the blueprint they're consuming.
 *
 * Separate file from blueprintSelectionService.ts (which stays a pure-query, no-Gemini
 * module) since this pulls in the Gemini client, a new prompt, and a retry wrapper.
 *
 * Deliberately no caching: synthesis is one extra Gemini call per generation request,
 * and actual image/video generation is the dominant cost either way. Always-fresh
 * synthesis avoids a cache-invalidation/staleness class of bugs for a marginal cost
 * saving — revisit only if this is ever a measured problem.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";

import { settings } from "../core/config";
import { IMAGE_SYNTHESIS_PROMPT_TEMPLATE, VIDEO_SYNTHESIS_PROMPT_TEMPLATE } from "../prompts/blueprintSynthesisPrompts";
import { AdBlueprint, adBlueprintSchema } from "../schemas/adBlueprint";
import { VideoBlueprint, videoBlueprintSchema } from "../schemas/videoBlueprint";
import { extractJsonFromText } from "../utils/json";
import { withTransientRetry } from "../utils/retry";
import { getCandidateBlueprintsForVertical } from "./blueprintSelectionService";

// Same pinned-version reasoning as adRemixService.ts/videoBlueprintService.ts's MODEL
// constant — see those files' comments if this one is ever deprecated.
const MODEL = "gemini-3.6-flash";

function getClient(): GoogleGenerativeAI {
  if (!settings.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }
  return new GoogleGenerativeAI(settings.GEMINI_API_KEY);
}

export async function synthesizeVerticalImageBlueprint(verticalId: string): Promise<AdBlueprint | null> {
  const candidates = await getCandidateBlueprintsForVertical(verticalId, "image");
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].blueprintJson as AdBlueprint;

  const blueprints = candidates.map((c) => c.blueprintJson as AdBlueprint);
  const model = getClient().getGenerativeModel({ model: MODEL });
  const result = await withTransientRetry(() => model.generateContent(IMAGE_SYNTHESIS_PROMPT_TEMPLATE(blueprints)));
  const parsed = extractJsonFromText(result.response.text());
  return adBlueprintSchema.parse(parsed);
}

export async function synthesizeVerticalVideoBlueprint(verticalId: string): Promise<VideoBlueprint | null> {
  const candidates = await getCandidateBlueprintsForVertical(verticalId, "video");
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].videoBlueprintJson as VideoBlueprint;

  const blueprints = candidates.map((c) => c.videoBlueprintJson as VideoBlueprint);
  const model = getClient().getGenerativeModel({ model: MODEL });
  const result = await withTransientRetry(() => model.generateContent(VIDEO_SYNTHESIS_PROMPT_TEMPLATE(blueprints)));
  const parsed = extractJsonFromText(result.response.text());
  return videoBlueprintSchema.parse(parsed);
}
