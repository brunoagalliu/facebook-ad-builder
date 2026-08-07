/**
 * AI UGC video generation via Kie.ai's Sora 2 storyboard model. The prompt structure
 * (iPhone-selfie framing, per-scene cinematography boilerplate, UGC authenticity
 * keywords, quality-control negative list, and the "reference a proven winner, then
 * iterate" character/product fidelity approach) is distilled from a course on AI UGC
 * ad production — see knowledge/direct_response/21_hook_iteration_from_reference.md
 * for the text-copy analogue of the same "iterate on proven references" principle.
 *
 * API contract (confirmed against docs.kie.ai, not just the course's example payloads):
 *   POST https://api.kie.ai/api/v1/jobs/createTask
 *     Authorization: Bearer <KIE_AI_API_KEY>, body { model, input }
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
import { CharacterInput, VideoGenerationRequestInput, VideoSceneInput } from "../schemas/videoGeneration";
import { uploadFile } from "./storage";

const KIE_BASE_URL = "https://api.kie.ai/api/v1/jobs";
const MODEL = "sora-2-pro-storyboard";

// Matches the "UGC Authenticity Keywords" / "Universal Quality Control Negatives"
// blocks present verbatim in every worked example in the course material — these
// are what keep Sora's output from reading as AI-generated (the "7 things that
// scream AI": dead eyes, floating products, too-perfect lighting, robot hands, etc).
const UGC_AUTHENTICITY_KEYWORDS =
  "smartphone selfie, handheld realism, influencer-style monologue, direct-to-camera, authentic recommendation, conversational delivery, raw unfiltered TikTok aesthetic, real voice, authentic performance, micro hand jitters, single continuous take, unedited";

const QUALITY_CONTROL_NEGATIVES =
  "subtitles, captions, watermark, text overlays, words on screen, logo, branding, poor lighting, blurry footage, low resolution, artifacts, unwanted objects, inconsistent character appearance, audio sync issues, amateur quality, cartoon effects, unrealistic proportions, distorted hands, artificial lighting, oversaturation, compression noise, camera shake";

/** Preserves the real product's label/packaging exactly rather than letting the
 * model reinterpret it — the single most repeated instruction across the course's
 * product-reference prompts ("pixel-perfect to img1... no redesign, recolor, or
 * artistic reinterpretation"), aimed at Sora's tendency to redraw uploaded labels. */
const PRODUCT_FIDELITY_CLAUSE =
  "All product typography, proportions, and artwork must remain pixel-perfect to the uploaded reference image with no redesign, recolor, or artistic reinterpretation.";

function buildCharacterClause(character?: CharacterInput): string {
  if (!character) return "Character: an authentic, relatable person filmed in natural UGC style";
  if (character.tag) return `Character: ${character.tag}`;

  const bits = [character.age, character.ethnicity, character.gender].filter(Boolean).join(" ");
  const base = character.name ? `${character.name}, a ${bits}`.trim() : `a ${bits}`.trim();
  return `Character: ${base}${character.description ? ` with ${character.description}` : ""}`.trim();
}

function buildSceneText(
  request: VideoGenerationRequestInput,
  scene: VideoSceneInput,
  index: number,
  characterClause: string
): string {
  const hasProductRef = request.productShots.length > 0;

  if (index > 0) {
    // Continuation shots reuse the established character/setting rather than
    // re-describing them — matches every multi-scene example in the source
    // material, which keeps Sora's storyboard shots visually consistent without
    // ballooning prompt length per shot.
    return `The exact same scene and character from before:\n${scene.action}`;
  }

  const location = request.location || "a cozy, well-lit home setting";
  const filename = `IMG_${Math.floor(1000 + Math.random() * 9000)}.MOV`;

  const parts = [
    `A casual, selfie-style IPHONE 15 PRO front-camera vertical video (9:16) filmed in ${location}, titled "${filename}".`,
    characterClause,
    hasProductRef ? PRODUCT_FIDELITY_CLAUSE : "",
    "Cinematography: Camera Shot: Medium close-up, slightly high angle, mostly stable framing with a slight gentle drift. Lens & DOF: IPHONE 15 PRO front camera (~24mm), no depth of field. Camera Motion: Subtle, natural handheld sway. Lighting: Bright, soft natural light. Color & Grade: IPHONE 15 PRO HDR auto-tone; neutral warm daylight palette with accurate, natural skin texture; no filters applied. Resolution & Aspect Ratio: 1080x1920, 30 fps, vertical.",
    `Actions:\n${scene.action}`,
    "Audio & Ambience: Recorded through the phone's built-in mic — crisp, clear voice with natural room tone. No music, no cuts; one continuous take.",
    `UGC Authenticity Keywords: ${UGC_AUTHENTICITY_KEYWORDS}.`,
    `Universal Quality Control Negatives: ${QUALITY_CONTROL_NEGATIVES}.`,
  ];

  return parts.filter(Boolean).join("\n\n");
}

export function buildVideoShots(request: VideoGenerationRequestInput): { duration: number; Scene: string }[] {
  const characterClause = buildCharacterClause(request.character);
  return request.scenes.map((scene, index) => ({
    duration: scene.durationSeconds,
    Scene: buildSceneText(request, scene, index, characterClause),
  }));
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

  const shots = request.customPrompt
    ? [{ duration: request.scenes[0]?.durationSeconds ?? 15, Scene: request.customPrompt }]
    : buildVideoShots(request);
  const totalDuration = shots.reduce((sum, s) => sum + s.duration, 0);

  const input: Record<string, unknown> = {
    aspect_ratio: request.aspectRatio,
    n_frames: String(totalDuration),
    remove_watermark: request.removeWatermark,
    shots,
  };
  if (request.productShots.length > 0) {
    input.image_urls = request.productShots;
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
