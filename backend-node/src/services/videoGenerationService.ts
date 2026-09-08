/**
 * AI UGC video generation via Kie.ai, supporting three models the user picks between
 * in the wizard (`request.model`):
 *   - "seedance-2-5" (default) — Bytedance Seedance 2.5, ByteDance's newer flagship.
 *     Ranked #1 on the Artificial Analysis text-to-video/image-to-video leaderboards
 *     as of mid-2026 and specifically strong on product-ad/UGC character consistency
 *     — confirmed to outperform Kling O3 on quality in this app's own live testing.
 *     One continuous take per call like Seedance 2.0 below (no multi-shot storyboard
 *     API), but natively generates up to 30s in a single pass — twice Seedance 2.0's
 *     and Kling's 15s ceiling — with richer reference support (up to 30
 *     reference_image_urls vs Kling's 2-4-per-element `elements` mechanism).
 *   - "seedance" — Bytedance Seedance 2.0, the original integration, kept as a
 *     cheaper/legacy option. One continuous single-shot take per call, no storyboard
 *     API. The prompt structure (iPhone-selfie framing, cinematography boilerplate,
 *     UGC authenticity keywords, quality-control negative list, and the "reference a
 *     proven winner, then iterate" character/product fidelity approach) is distilled
 *     from a course on AI UGC ad production — see
 *     knowledge/direct_response/21_hook_iteration_from_reference.md for the text-copy
 *     analogue of the same "iterate on proven references" principle.
 *   - "kling-o3" — Kling 3.0 Omni (kling-3.0-omni/text-to-video), a genuinely
 *     different model that supports real multi-shot storyboarding: up to 6 distinct
 *     shots, each with its own prompt/duration, cut together in one generation
 *     (buildKlingInput below). Confirmed via Kie.ai's own API docs
 *     (docs.kie.ai/market/kling/v3-omni-text-to-video) rather than guessed. Still the
 *     only option with real per-shot cuts and the long-video (`part2`) continuation
 *     mode — Seedance 2.5's native 30s ceiling covers the same "longer than 15s" need
 *     for anything that fits in one continuous take, without needing that chaining
 *     machinery at all.
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
 * All three models share the exact same Kie.ai job API — only the `model` string and
 * `input` shape submitted to createTask differ; polling and result-download are
 * completely model-agnostic:
 *   POST https://api.kie.ai/api/v1/jobs/createTask
 *     Authorization: Bearer <KIE_AI_API_KEY>, body { model, input }
 *     Seedance 2.0 input: { prompt, duration (4-15s), aspect_ratio, resolution,
 *              generate_audio, reference_image_urls? }
 *     Seedance 2.5 input: { prompt, duration (4-30s), aspect_ratio, resolution,
 *              generate_audio, reference_image_urls? (up to 30, aspect ratio
 *              0.4-2.5 each) } — see buildSeedance25Input.
 *     Kling O3 input: { prompt, customize_multi_shots, multi_prompt: [{prompt,
 *              duration}], audio, resolution (720p/1080p/4k, no 480p), aspect_ratio,
 *              duration (3-15s) } — see buildKlingInput.
 *     -> { code, msg, data: { taskId } }
 *   GET  https://api.kie.ai/api/v1/jobs/recordInfo?taskId=...
 *     -> { data: { state: "waiting"|"queuing"|"generating"|"success"|"fail",
 *                  progress?, resultJson? (JSON string containing resultUrls[]),
 *                  failMsg? } }
 * Result URLs expire 24h after completion, so a successful poll must download and
 * persist the video immediately — mirrors downloadAndSaveImage's same constraint for
 * Fal.ai's image URLs in imageGenerationService.ts.
 */
import { execFile } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";
import sharp from "sharp";

import { settings } from "../core/config";
import { prisma } from "../core/prisma";
import { CharacterInput, Part2Input, VideoEditRequestInput, VideoGenerationRequestInput } from "../schemas/videoGeneration";
import { selectBlueprintForBrand, selectVideoBlueprintForBrand } from "./blueprintSelectionService";
import { synthesizeVerticalImageBlueprint, synthesizeVerticalVideoBlueprint } from "./blueprintSynthesisService";
import { uploadFile } from "./storage";
import { attachTaskId, finalizeVideoGenerationLogById, startVideoGenerationLog } from "./aiUsageService";

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

const execFileAsync = promisify(execFile);

const KIE_BASE_URL = "https://api.kie.ai/api/v1/jobs";
const MODEL_SEEDANCE = "bytedance/seedance-2";
const MODEL_SEEDANCE_25 = "bytedance/seedance-2-5";
const MODEL_KLING = "kling-3.0-omni/text-to-video";
const MIN_DURATION = 4;
const MAX_DURATION = 15;
// Kling's floor is genuinely different from Seedance's (3s vs 4s) — kept as separate
// constants rather than widening the shared ones, since Seedance would still reject a
// 3s request.
const KLING_MIN_DURATION = 3;
const KLING_MAX_DURATION = 15;
// Seedance 2.5's headline difference from 2.0: a single call natively reaches 30s
// (confirmed via Kie.ai's own docs), not just 15 — see the file-level doc comment.
const SEEDANCE_25_MIN_DURATION = 4;
const SEEDANCE_25_MAX_DURATION = 30;

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

// Lead-gen ads (debt relief, insurance, etc.) very commonly cut to the character
// showing the actual signup form/website on their phone mid-pitch — confirmed live
// this session, both as a real "authenticity signal" Gemini extracted from a genuine
// competitor ad ("Physical phone screen held to lens") and in a synthesized
// cross-vertical blueprint's narrative arc ("...-> Solution Discovery & Mobile UI
// Demo -> Direct CTA"), and by looking at a real client funnel page directly
// (turbodebt.com's own lead form: "This is the Last Step, Promise!" over Full Name /
// Email / Phone Number / state-select fields and a bold green CTA button) — that
// generic shape (short reassuring headline, 3-4 stacked text inputs, one bold CTA
// button) is genuinely how most direct-response lead-capture forms look, not specific
// to this one brand. Seedance can't browse a URL or know what any real product's
// actual page looks like, so this describes that generic, believable shape rather
// than leaving the model to invent something arbitrary (or nothing at all) whenever a
// scene calls for a phone reveal. Seedance also has no multi-shot/compositing API to
// cut to a separate screen recording, but a person genuinely holding and showing
// their phone is well within what a single continuous take can render. Always
// included (not conditional on scene text matching some keyword list) since it's
// self-gating via its own "if the action calls for it" framing — a harmless no-op for
// videos that never mention a phone/screen.
const PHONE_REVEAL_CLAUSE =
  "Phone/Screen Reveal: if any action calls for showing a phone, website, or signup form, angle the phone screen toward the camera for a beat so the on-screen content reads as legible, then return to normal talking-head framing — a natural handheld reveal within the same continuous shot, not a cutaway or separate screen recording. Unless the action specifies otherwise, render the on-screen content as a typical clean lead-capture form: a short reassuring headline (e.g. \"Last Step\"), 3-4 stacked white input fields with gray placeholder text (name, email, phone, and similar), and one bold, brightly-colored CTA button below — a believable modern form, not a screenshot of any specific real website.";

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
export function buildVideoPrompt(request: VideoGenerationRequestInput, blueprintInsight?: VideoBlueprintInsight): string {
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
    PHONE_REVEAL_CLAUSE,
    "Audio & Ambience: Crisp, clear voice with natural room tone. No music, no cuts; one continuous take.",
    `UGC Authenticity Keywords: ${authenticityKeywords}.`,
    `Universal Quality Control Negatives: ${QUALITY_CONTROL_NEGATIVES}.`,
  ];

  return parts.filter(Boolean).join("\n\n");
}

function buildAspectRatio(aspectRatio: VideoGenerationRequestInput["aspectRatio"]): string {
  return aspectRatio === "landscape" ? "16:9" : "9:16";
}

// Shared by both Seedance tiers, which only differ in their min/max bounds (2.0: 4-15s,
// 2.5: 4-30s) — Kling inlines the same Math.min/max at its own call site since its
// duration also feeds into buildKlingInput's returned object rather than standing alone.
function clampDuration(totalSeconds: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, totalSeconds));
}

const KLING_PROMPT_MAX_CHARS = 3072;

// Kling's `elements` mechanism requires each multi-image subject to have 2-4 images
// (confirmed via Kie.ai's docs — not a guess like the previous omission was). A single
// screenshot doesn't meet that floor, so there's nothing valid to send in that case.
const KLING_ELEMENT_MIN_IMAGES = 2;
const KLING_ELEMENT_MAX_IMAGES = 4;
const KLING_PRODUCT_ELEMENT_NAME = "product";
// Confirmed live: Kie.ai rejects any Kling element (or Seedance 2.5 reference) image
// outside this width/height range ("aspect ratio must be between 0.4 and 2.5") —
// landing-page screenshots (screenshotService.ts) are deliberately full-page/tall for
// human review (a real one came back 390x2863, ratio ~0.14), so they routinely
// violate this. Shared by both models' reference-image handling (prepareReferenceImage).
const REFERENCE_IMAGE_MIN_ASPECT = 0.4;
const REFERENCE_IMAGE_MAX_ASPECT = 2.5;

/** Kling's top-level `prompt` is a required *fallback* summary, capped at 3072 chars
 * by Kie.ai (confirmed live: reusing buildVideoPrompt's full Seedance-style output —
 * cinematography paragraph, UGC keyword list, quality-control negatives, phone-reveal
 * clause — hit that cap on a real API call with just 2 short scenes and no character
 * detail, at 2444 chars before even adding more). The real per-shot content already
 * lives in `multi_prompt` below, so this only needs to be a brief scene-by-scene
 * summary, not the full boilerplate-heavy prompt built for Seedance. Hard-truncated as
 * a safety net regardless, since a long character description + many scenes could
 * still theoretically exceed the cap.
 *
 * hasProductElement appends an @name mention (Kling's documented syntax for invoking a
 * defined `elements` entry) so the model actually knows to draw on it — defining an
 * element without ever referencing it by name in a prompt would leave it unused. This
 * is deliberately added to the fallback summary rather than rewritten into individual
 * scene actions, since mangling user-authored scene text to insert a tag is riskier
 * than one added sentence on the summary Kling already treats as a whole-generation
 * fallback. */
function buildKlingFallbackPrompt(
  request: VideoGenerationRequestInput,
  blueprintInsight?: VideoBlueprintInsight,
  hasProductElement?: boolean
): string {
  if (request.customPrompt) return request.customPrompt.slice(0, KLING_PROMPT_MAX_CHARS);

  const location = request.location || "a cozy, well-lit home setting";
  const characterClause = buildCharacterClause(request.character);
  const hookHint = blueprintInsight?.hook_type ? ` Open with a "${blueprintInsight.hook_type}"-style hook.` : "";
  const sceneSummary = request.scenes.map((s, i) => `Shot ${i + 1}: ${s.action}`).join(" ");
  const productHint = hasProductElement
    ? ` Reference the @${KLING_PRODUCT_ELEMENT_NAME} asset for the product/signup page shown in this video, keeping it pixel-perfect to those reference images.`
    : "";

  const prompt = `A casual, selfie-style UGC video filmed in ${location}. ${characterClause}.${hookHint} ${sceneSummary}${productHint}`.trim();
  return prompt.length > KLING_PROMPT_MAX_CHARS ? `${prompt.slice(0, KLING_PROMPT_MAX_CHARS - 3)}...` : prompt;
}

// Each multi_prompt shot entry is capped at 512 chars by Kie.ai (separate from, and
// much tighter than, the top-level prompt's 3072) — confirmed via Kie.ai's own docs.
// Nowhere near enough room for Seedance's full boilerplate (its cinematography
// paragraph alone runs ~400 chars, before the UGC-keyword and quality-control-negative
// lists), so this is a condensed version carrying the same real signal: framing/
// lighting/handheld-camera direction and the highest-value "don't look AI-generated"
// negatives, distilled to fit every shot's budget alongside the user's own scene text.
const KLING_SHOT_PROMPT_MAX_CHARS = 512;
const KLING_SHOT_STYLE_CLAUSE =
  "iPhone front-camera selfie style, medium close-up, natural handheld sway, soft natural light, authentic UGC delivery. Avoid: text overlays, watermark, distorted hands, cartoon look, artificial lighting.";

/** Builds one shot's multi_prompt entry: the user's own scene text is never trimmed
 * (it's the actual content), only the added style/character/hook boilerplate gets cut
 * if the combination would exceed Kling's 512-char per-shot cap. Character and hook
 * framing are only prepended on the first scene — repeating them on every shot would
 * burn budget better spent on the per-shot style clause, and Kling's own multi-shot
 * consistency (same generation call, same subject) is what's expected to carry the
 * character across the later shots, same as it would for a real film's later cuts. */
function buildKlingShotPrompt(
  scene: VideoGenerationRequestInput["scenes"][number],
  index: number,
  request: VideoGenerationRequestInput,
  blueprintInsight?: VideoBlueprintInsight
): string {
  const extras: string[] = [];
  if (index === 0) {
    extras.push(`${buildCharacterClause(request.character)}.`);
    if (blueprintInsight?.hook_type) extras.push(`Open with a "${blueprintInsight.hook_type}"-style hook.`);
  }
  extras.push(KLING_SHOT_STYLE_CLAUSE);

  const full = [scene.action, ...extras].join(" ");
  if (full.length <= KLING_SHOT_PROMPT_MAX_CHARS) return full;

  const budget = KLING_SHOT_PROMPT_MAX_CHARS - scene.action.length - 1;
  if (budget < 20) return scene.action.slice(0, KLING_SHOT_PROMPT_MAX_CHARS);
  return `${scene.action} ${extras.join(" ").slice(0, budget - 3)}...`;
}

/** Crops an image down to a 0.4-2.5 aspect ratio if it's outside that range,
 * re-uploading the crop and returning its new URL; returns the original URL unchanged
 * if already valid (the common case for manually-uploaded product photos — this only
 * re-processes what actually needs it). Shared by Kling's `elements` mechanism and
 * Seedance 2.5's `reference_image_urls` — confirmed via both models' Kie.ai docs to
 * enforce the identical 0.4-2.5 bound, so one crop helper covers both. Top-crops
 * (keeps width, trims height) rather than center- or bottom-cropping, since a landing
 * page's hero/header — the top of the page — is the most recognizable, useful crop for
 * a reference image, not an arbitrary lower slice. Returns null if the image can't be
 * fetched/decoded at all, so the caller can drop it rather than fail the whole
 * generation over one bad URL. */
async function prepareReferenceImage(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(buffer).metadata();
    if (!metadata.width || !metadata.height) return null;

    const aspect = metadata.width / metadata.height;
    if (aspect >= REFERENCE_IMAGE_MIN_ASPECT && aspect <= REFERENCE_IMAGE_MAX_ASPECT) {
      return url;
    }

    const targetWidth = aspect > REFERENCE_IMAGE_MAX_ASPECT ? Math.round(metadata.height * REFERENCE_IMAGE_MAX_ASPECT) : metadata.width;
    const targetHeight = aspect < REFERENCE_IMAGE_MIN_ASPECT ? Math.round(metadata.width / REFERENCE_IMAGE_MIN_ASPECT) : metadata.height;

    const cropped = await sharp(buffer)
      .extract({
        left: 0,
        top: 0,
        width: Math.min(targetWidth, metadata.width),
        height: Math.min(targetHeight, metadata.height),
      })
      .jpeg({ quality: 90 })
      .toBuffer();

    return await uploadFile(cropped, `${randomUUID()}-kling-ref.jpg`, "image/jpeg");
  } catch (err) {
    console.error("Failed to prepare reference image:", url, err);
    return null;
  }
}

/** Builds the `elements` entry for the product/signup-page reference, or undefined if
 * there aren't enough valid shots to meet Kling's own 2-4-image floor for a
 * multi-image subject (confirmed via Kie.ai's docs:
 * docs.kie.ai/market/kling/v3-omni-text-to-video — `elements[].element_input_urls`
 * needs 2-4 images or exactly 1 video, referenced in prompts via `@name`). A single
 * screenshot has no valid representation here, unlike Seedance's
 * reference_image_urls which accepts any count starting at 1. */
async function buildProductElement(request: VideoGenerationRequestInput): Promise<Record<string, unknown> | undefined> {
  const prepared = await Promise.all(request.productShots.map(prepareReferenceImage));
  const valid = prepared.filter((url): url is string => url !== null);
  if (valid.length < KLING_ELEMENT_MIN_IMAGES) return undefined;

  const productName = (request.product as Record<string, unknown> | undefined)?.name as string | undefined;
  return {
    name: KLING_PRODUCT_ELEMENT_NAME,
    description: productName ? `${productName} product photos and signup page` : "product photos and signup page",
    element_input_urls: valid.slice(0, KLING_ELEMENT_MAX_IMAGES),
  };
}

/** Builds the input body for Kling O3's multi-shot storyboard API — each scene maps
 * 1:1 onto a real distinct shot via `multi_prompt` (unlike Seedance, where scenes are
 * flattened into one continuous-take prompt string). */
export async function buildKlingInput(
  request: VideoGenerationRequestInput,
  blueprintInsight?: VideoBlueprintInsight
): Promise<Record<string, unknown>> {
  const totalDuration = request.scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  const productElement = await buildProductElement(request);
  return {
    prompt: buildKlingFallbackPrompt(request, blueprintInsight, Boolean(productElement)),
    customize_multi_shots: true,
    multi_prompt: request.scenes.map((s, i) => ({ prompt: buildKlingShotPrompt(s, i, request, blueprintInsight), duration: s.durationSeconds })),
    ...(productElement ? { elements: [productElement] } : {}),
    // Seedance always hardcodes audio on (below) — these are talking-head UGC ads, so
    // silent output would be a regression. Kling's own default is false.
    audio: true,
    // Kling has no 480p tier (confirmed via Kie.ai's docs: 720p/1080p/4k only) — floor
    // rather than submit a value it would reject.
    resolution: request.resolution === "480p" ? "720p" : request.resolution,
    aspect_ratio: buildAspectRatio(request.aspectRatio),
    duration: Math.min(KLING_MAX_DURATION, Math.max(KLING_MIN_DURATION, totalDuration)),
  };
}

/** Builds the input body for Seedance 2.5 — same continuous-take prompt shape as
 * Seedance 2.0 (buildVideoPrompt already handles both; there's no per-model prompt
 * difference), but with a 30s duration ceiling instead of 15 and reference_image_urls
 * cropped to the same 0.4-2.5 aspect-ratio bound Kling's `elements` enforces (unlike
 * Kling, Seedance 2.5 has no documented minimum image count, so even a single valid
 * shot is sent rather than requiring 2+). */
async function buildSeedance25Input(request: VideoGenerationRequestInput, blueprintInsight?: VideoBlueprintInsight): Promise<Record<string, unknown>> {
  const totalDuration = request.scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
  const input: Record<string, unknown> = {
    prompt: buildVideoPrompt(request, blueprintInsight),
    duration: clampDuration(totalDuration, SEEDANCE_25_MIN_DURATION, SEEDANCE_25_MAX_DURATION),
    aspect_ratio: buildAspectRatio(request.aspectRatio),
    resolution: request.resolution,
    generate_audio: true,
  };

  if (request.productShots.length > 0) {
    const prepared = await Promise.all(request.productShots.map(prepareReferenceImage));
    const valid = prepared.filter((url): url is string => url !== null);
    if (valid.length > 0) input.reference_image_urls = valid;
  }

  return input;
}

export interface CutawayWindow {
  start: number;
  end: number;
  imageUrl: string;
}

/** Cumulative-sums scene durations to derive each scene's [start, end) window, then
 * keeps only the ones with a cutawayImageUrl set. Kling-only (see videoSceneSchema's
 * cutawayImageUrl comment) — callers are responsible for not calling this for
 * Seedance, where these timestamps wouldn't correspond to anything real. */
function buildCutawayPlan(request: VideoGenerationRequestInput): CutawayWindow[] {
  let cursor = 0;
  const windows: CutawayWindow[] = [];
  for (const scene of request.scenes) {
    const start = cursor;
    cursor += scene.durationSeconds;
    if (scene.cutawayImageUrl) {
      windows.push({ start, end: cursor, imageUrl: scene.cutawayImageUrl });
    }
  }
  return windows;
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

/** Resolves which blueprint should steer generation based on request.mode — "auto"
 * (default) keeps today's random-pick-from-the-brand's-vertical-pool behavior
 * unchanged; "single" uses one specific WinningAd the user picked (throws rather than
 * silently falling back to auto, since a silent substitution would be a confusing
 * bait-and-switch for an explicit choice); "vertical" uses a synthesized meta-blueprint
 * combining the whole vertical's pool (blueprintSynthesisService.ts), same video-then-
 * image fallback order as selectBestVideoInsight above. */
async function resolveVideoInsight(
  request: VideoGenerationRequestInput,
  brandId: string | undefined
): Promise<VideoBlueprintInsight | undefined> {
  if (request.mode === "single") {
    if (!request.templateId) throw new Error('templateId is required when mode is "single"');
    const template = await prisma.winningAd.findUnique({ where: { id: request.templateId } });
    if (!template) throw new Error("Template not found");
    const insight = (template.videoBlueprintJson ?? template.blueprintJson) as VideoBlueprintInsight | null;
    if (!insight) throw new Error("This template has no analyzed blueprint to use");
    return insight;
  }

  if (request.mode === "vertical") {
    const brand = brandId ? await prisma.brand.findUnique({ where: { id: brandId } }) : null;
    if (!brand?.verticalId) return undefined;
    const videoBlueprint = await synthesizeVerticalVideoBlueprint(brand.verticalId);
    if (videoBlueprint) return videoBlueprint as VideoBlueprintInsight;
    const imageBlueprint = await synthesizeVerticalImageBlueprint(brand.verticalId);
    return imageBlueprint as VideoBlueprintInsight | undefined;
  }

  return brandId ? selectBestVideoInsight(brandId) : undefined;
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

  const brandId = (request.brand as Record<string, unknown> | undefined)?.id as string | undefined;

  // Flat if/else branch per model, mirroring imageGenerationService.ts's
  // generateImages — each branch builds its own request shape independently rather
  // than forcing all three models through a shared abstraction.
  const isKling = request.model === "kling-o3";
  const isSeedance25 = request.model === "seedance-2-5";
  const model = isKling ? MODEL_KLING : isSeedance25 ? MODEL_SEEDANCE_25 : MODEL_SEEDANCE;

  // Cutaway plan is computed here (while we still have the real scene list) and
  // stashed on the log row keyed by taskId, since the poll route that eventually
  // downloads the video only ever sees a bare taskId — see aiUsageService.ts's
  // getLogMetadataByTaskId.
  const cutaways = isKling ? buildCutawayPlan(request) : [];

  // stage:"segment1" tells the poll route to chain a second Kie.ai job (segment 2, an
  // image-to-video continuation seeded from segment 1's last frame) instead of
  // finalizing on first success — see generatedAds.ts's GET /generate-video/:id.
  const metadata: Record<string, unknown> = {};
  if (cutaways.length) metadata.cutaways = cutaways;
  if (isKling && request.part2) {
    metadata.part2 = request.part2;
    metadata.stage = "segment1";
    // Segment 2's own resolution falls back to this if request.part2.resolution isn't
    // explicitly set — stashed now since the poll route that creates segment 2's task
    // only has access to whatever survives in this metadata blob, not the original request.
    metadata.resolution = request.resolution;
  }

  // Started before the createTask call so a "pending" row exists even if createTask
  // itself throws below — finalizeVideoGenerationLogById closes it out as an error in
  // that case since no taskId ever gets assigned. Finalized later (success/fail) by
  // GET /generate-video/:id in generatedAds.ts once polling observes a terminal state,
  // since that happens well after this function has already returned. This row's own
  // id (not Kie.ai's taskId) is what gets returned to the caller below — see
  // aiUsageService.ts's getLogById for why the two are deliberately different things.
  const logId = await startVideoGenerationLog({
    model,
    brandId,
    metadata: Object.keys(metadata).length ? metadata : undefined,
  });

  try {
    const blueprintInsight = await resolveVideoInsight(request, brandId);

    let input: Record<string, unknown>;
    if (isKling) {
      input = await buildKlingInput(request, blueprintInsight);
    } else if (isSeedance25) {
      input = await buildSeedance25Input(request, blueprintInsight);
    } else {
      const totalDuration = request.scenes.reduce((sum, s) => sum + s.durationSeconds, 0);
      input = {
        prompt: buildVideoPrompt(request, blueprintInsight),
        duration: clampDuration(totalDuration, MIN_DURATION, MAX_DURATION),
        aspect_ratio: buildAspectRatio(request.aspectRatio),
        resolution: request.resolution,
        generate_audio: true,
      };
      if (request.productShots.length > 0) {
        input.reference_image_urls = request.productShots;
      }
    }

    const response = await fetch(`${KIE_BASE_URL}/createTask`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.KIE_AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, input }),
    });

    const data = (await response.json()) as CreateTaskResponse;
    if (!response.ok || data.code !== 200 || !data.data?.taskId) {
      throw new Error(data.msg || `Kie.ai createTask failed with status ${response.status}`);
    }
    await attachTaskId(logId, data.data.taskId);
    return logId;
  } catch (err) {
    await finalizeVideoGenerationLogById(logId, { status: "error", errorMessage: (err as Error).message });
    throw err;
  }
}

/** Targeted edit on an already-generated video, reusing the exact same job/poll
 * pipeline as createVideoTask (same log-row lifecycle, same GET /generate-video/:id
 * route downstream — that route already falls through to the plain single-segment
 * path for any log with no `stage` metadata, which this doesn't set). `duration: -1`
 * and `reference_video_urls` are what make Kie.ai treat this as an edit rather than a
 * fresh generation — see videoEditRequestSchema's doc comment for how that was
 * confirmed. Seedance 2.5 only; no equivalent exists on Seedance 2.0 or Kling. */
export async function createVideoEditTask(request: VideoEditRequestInput): Promise<string> {
  if (!settings.KIE_AI_API_KEY) {
    throw new Error("KIE_AI_API_KEY not configured");
  }

  const logId = await startVideoGenerationLog({ model: MODEL_SEEDANCE_25, brandId: request.brandId });

  try {
    const input = {
      prompt: request.instruction,
      reference_video_urls: [request.sourceVideoUrl],
      duration: -1,
      resolution: request.resolution,
      generate_audio: true,
    };

    const response = await fetch(`${KIE_BASE_URL}/createTask`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.KIE_AI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: MODEL_SEEDANCE_25, input }),
    });

    const data = (await response.json()) as CreateTaskResponse;
    if (!response.ok || data.code !== 200 || !data.data?.taskId) {
      throw new Error(data.msg || `Kie.ai createTask (edit) failed with status ${response.status}`);
    }
    await attachTaskId(logId, data.data.taskId);
    return logId;
  } catch (err) {
    await finalizeVideoGenerationLogById(logId, { status: "error", errorMessage: (err as Error).message });
    throw err;
  }
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

/** Overlays each cutaway's image over the source video for its [start, end) window,
 * replacing only the picture — the original audio track is copied through untouched
 * (`-map 0:a? -c:a copy`), so narration keeps playing under the cut exactly like a
 * real "talking head -> screen-recording B-roll -> back" edit. Chains one `overlay`
 * filter per cutaway rather than trying to do it in one filtergraph node, since each
 * window is independent and this reads far more straightforwardly for 1-3 cutaways.
 * Returns the original buffer unchanged on any failure (missing ffmpeg, a bad image
 * URL, a malformed window) — a cutaway is a nice-to-have polish step, and losing an
 * otherwise-successful generation over it would be a much worse outcome than just
 * skipping the overlay. */
export async function applyCutaways(videoBuffer: Buffer, cutaways: CutawayWindow[]): Promise<Buffer> {
  if (cutaways.length === 0) return videoBuffer;

  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "cutaway-"));
  try {
    const inputPath = path.join(workDir, "input.mp4");
    await fs.writeFile(inputPath, videoBuffer);

    const imagePaths: string[] = [];
    for (const [i, cutaway] of cutaways.entries()) {
      const imageResponse = await fetch(cutaway.imageUrl, { signal: AbortSignal.timeout(30_000) });
      if (!imageResponse.ok) throw new Error(`Failed to download cutaway image: ${imageResponse.status}`);
      const imagePath = path.join(workDir, `cutaway-${i}.jpg`);
      await fs.writeFile(imagePath, Buffer.from(await imageResponse.arrayBuffer()));
      imagePaths.push(imagePath);
    }

    // scale2ref's ref_w/ref_h cross-reference expression doesn't parse on the ffmpeg
    // build actually deployed (confirmed live: "Undefined constant or missing '(' in
    // 'ref_w'") despite being documented — probing the real dimensions with ffprobe
    // first and using a plain literal `scale=W:H` sidesteps that filter entirely
    // rather than fighting a version-specific expression-parsing quirk.
    const { stdout: dimensionsOut } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=s=x:p=0",
      inputPath,
    ]);
    const [videoWidth, videoHeight] = dimensionsOut.trim().split("x").map(Number);
    if (!videoWidth || !videoHeight) throw new Error(`Could not determine video dimensions from ffprobe output: "${dimensionsOut}"`);

    const outputPath = path.join(workDir, "output.mp4");
    const inputArgs = imagePaths.flatMap((p) => ["-i", p]);

    const scaleSteps = cutaways.map((_, i) => `[${i + 1}:v]scale=${videoWidth}:${videoHeight}[img${i}]`);
    // Overlays chain sequentially — each step's output feeds the next step's base,
    // gated to only that cutaway's own time window so only one image shows at a time.
    const overlaySteps = cutaways.map((cutaway, i) => {
      const src = i === 0 ? "0:v" : `v${i}`;
      const outLabel = i === cutaways.length - 1 ? "vout" : `v${i + 1}`;
      return `[${src}][img${i}]overlay=enable='between(t,${cutaway.start},${cutaway.end})'[${outLabel}]`;
    });

    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      ...inputArgs,
      "-filter_complex",
      [...scaleSteps, ...overlaySteps].join(";"),
      "-map",
      "[vout]",
      "-map",
      "0:a?",
      "-c:a",
      "copy",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      outputPath,
    ]);

    return await fs.readFile(outputPath);
  } catch (err) {
    console.error("Failed to apply video cutaways, using original video instead:", err);
    return videoBuffer;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Kie.ai's result URLs expire 24h after task completion — download immediately
 * rather than storing the ephemeral URL, mirroring downloadAndSaveImage. Shared by the
 * plain single-segment path below and long-video mode's segment-handling in
 * generatedAds.ts, which needs the raw buffer before deciding what to do with it. */
export async function downloadVideoBuffer(videoUrl: string): Promise<Buffer> {
  const response = await fetch(videoUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Failed to download video: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function downloadAndSaveVideo(videoUrl: string, cutaways: CutawayWindow[] = []): Promise<string> {
  const rawBuffer = await downloadVideoBuffer(videoUrl);
  const buffer = await applyCutaways(rawBuffer, cutaways);
  const filename = `generated_${randomUUID()}.mp4`;
  return uploadFile(buffer, filename, "video/mp4");
}

/** Grabs the final frame of a video as a still image — the seed for long-video mode's
 * segment 2 (an image-to-video continuation), so it visually picks up exactly where
 * segment 1 left off. `-sseof -1` seeks 1s before end-of-file (robust without needing
 * to know the exact duration up front) then takes 1 frame. Unlike applyCutaways, there
 * is no original-buffer fallback on failure — there's no sane default for "couldn't get
 * a starting frame," so this propagates and the caller finalizes a real error rather
 * than silently producing a broken segment 2. */
export async function extractLastFrame(videoBuffer: Buffer): Promise<Buffer> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "lastframe-"));
  try {
    const inputPath = path.join(workDir, "input.mp4");
    await fs.writeFile(inputPath, videoBuffer);
    const framePath = path.join(workDir, "frame.jpg");
    await execFileAsync("ffmpeg", ["-y", "-sseof", "-1", "-i", inputPath, "-frames:v", "1", "-q:v", "2", framePath]);
    return await fs.readFile(framePath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Creates segment 2's Kie.ai job — a genuinely different model from segment 1's
 * multi-shot "kling-3.0-omni/text-to-video": "kling/v3-turbo-image-to-video" takes a
 * single prompt + single duration (no multi_prompt array) seeded from a starting
 * image. Confirmed against Kie.ai's own docs, not guessed. Kling has no 1080p-only
 * gap like the main model's 480p floor, but still normalizes away anything this app
 * doesn't otherwise support. */
export async function createSegment2Task(part2: Part2Input, imageUrl: string, fallbackResolution: string): Promise<string> {
  const input = {
    prompt: part2.action.slice(0, 2500),
    image_urls: [imageUrl],
    duration: String(part2.durationSeconds),
    resolution: part2.resolution ?? (fallbackResolution === "480p" ? "720p" : fallbackResolution),
  };
  const response = await fetch(`${KIE_BASE_URL}/createTask`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.KIE_AI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: "kling/v3-turbo-image-to-video", input }),
  });
  const data = (await response.json()) as CreateTaskResponse;
  if (!response.ok || data.code !== 200 || !data.data?.taskId) {
    throw new Error(data.msg || `Kie.ai createTask (segment 2) failed with status ${response.status}`);
  }
  return data.data.taskId;
}

/** Concatenates two independently-generated clips into one final video. Uses the
 * filter_complex concat approach rather than the concat demuxer's fast stream-copy
 * path, since there's no guarantee two different Kie.ai models emit byte-identical
 * codec parameters — the same "don't trust an undocumented fast path" lesson as
 * applyCutaways abandoning scale2ref once it didn't parse on the deployed ffmpeg
 * build. Re-probes segment 1's real dimensions (consistent with applyCutaways) and
 * scales/normalizes both inputs to match before the concat filter, which requires
 * uniform format. Falls back to returning segment 1 alone on any failure — still a
 * real, playable video, the same "never lose a working result over a polish step"
 * precedent applyCutaways already established. */
export async function concatenateVideos(seg1Buffer: Buffer, seg2Buffer: Buffer): Promise<Buffer> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "concat-"));
  try {
    const seg1Path = path.join(workDir, "seg1.mp4");
    const seg2Path = path.join(workDir, "seg2.mp4");
    await fs.writeFile(seg1Path, seg1Buffer);
    await fs.writeFile(seg2Path, seg2Buffer);

    const { stdout: dimensionsOut } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=s=x:p=0",
      seg1Path,
    ]);
    const [width, height] = dimensionsOut.trim().split("x").map(Number);
    if (!width || !height) throw new Error(`Could not determine segment 1 dimensions from ffprobe output: "${dimensionsOut}"`);

    // Neither segment is guaranteed to have an audio stream — segment 2 comes from a
    // different Kie.ai model (kling/v3-turbo-image-to-video) whose audio behavior
    // isn't documented the way segment 1's explicit `audio: true` flag is. Probing
    // each file and substituting a silent track for whichever lacks one avoids a hard
    // ffmpeg failure (and the resulting silent fallback to segment 1 alone) over
    // something as unimportant as one segment being quiet.
    const hasAudioStream = async (filePath: string): Promise<boolean> => {
      const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", filePath]);
      return stdout.trim().length > 0;
    };
    const [seg1HasAudio, seg2HasAudio] = await Promise.all([hasAudioStream(seg1Path), hasAudioStream(seg2Path)]);

    const inputArgs = ["-i", seg1Path, "-i", seg2Path];
    let nextInputIndex = 2;
    const audioLabelFor = (segHasAudio: boolean, sourceIndex: number, outLabel: string): string => {
      if (segHasAudio) return `[${sourceIndex}:a]aformat=sample_rates=44100:channel_layouts=stereo[${outLabel}];`;
      const silentIndex = nextInputIndex++;
      inputArgs.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
      return `[${silentIndex}:a]atrim=duration=15[${outLabel}];`;
    };
    // atrim caps the silent track at a safe upper bound (both segments' durations are
    // already individually capped at 15s by their own schemas) — concat only uses as
    // much of it as the paired video stream runs for, so overshooting is harmless.
    const audio0 = audioLabelFor(seg1HasAudio, 0, "a0");
    const audio1 = audioLabelFor(seg2HasAudio, 1, "a1");

    const outputPath = path.join(workDir, "output.mp4");
    await execFileAsync("ffmpeg", [
      "-y",
      ...inputArgs,
      "-filter_complex",
      `[0:v]scale=${width}:${height},setsar=1,fps=30[v0];` + `[1:v]scale=${width}:${height},setsar=1,fps=30[v1];` + audio0 + audio1 + `[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][aout]`,
      "-map",
      "[vout]",
      "-map",
      "[aout]",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      outputPath,
    ]);

    return await fs.readFile(outputPath);
  } catch (err) {
    console.error("Failed to concatenate long-video segments, using segment 1 alone instead:", err);
    return seg1Buffer;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
