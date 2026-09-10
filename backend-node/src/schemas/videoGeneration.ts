import { z } from "zod";

const recordSchema = z.record(z.string(), z.unknown());

// One beat of dialogue/action within the video. For both Seedance tiers (no
// multi-shot/storyboard API) these are concatenated into one continuous prompt by
// videoGenerationService, so the sum of scene durations is what's clamped to the
// model's ceiling (15s for "seedance", 30s for "seedance-2-5"), not each scene alone.
// For Kling O3 (see `model` below), each scene maps 1:1 onto a real distinct shot/cut
// via its multi_prompt API — same duration-sum-ceiling idea, but up to 6 scenes
// instead of 3 since they're genuinely separate shots, not narrative beats within one
// take. Per-scene max bumped to 30 to let a single Seedance 2.5 scene span its whole
// duration; other models' own ceilings are enforced by clamping the summed total in
// videoGenerationService, not by this per-scene bound. Scene *count* caps (3 vs 6) are
// enforced client-side, not re-validated here.
export const videoSceneSchema = z.object({
  durationSeconds: z.number().int().min(1).max(30),
  action: z.string().min(1),
  // One of the product's real screenshots — overlays as this scene's entire visual in
  // the final video (audio/narration untouched), replacing whatever Kling renders for
  // it. Kling only: each scene maps to a real, Kie.ai-honored shot duration there, so
  // the overlay's time window is trustworthy; Seedance flattens scenes into one
  // continuous AI-generated take with no per-beat timing guarantee, so this is ignored
  // for that model rather than guessed at.
  cutawayImageUrl: z.string().optional(),
});
export type VideoSceneInput = z.infer<typeof videoSceneSchema>;

export const characterSchema = z.object({
  name: z.string().optional(),
  age: z.string().optional(),
  ethnicity: z.string().optional(),
  gender: z.string().optional(),
  // Free-form extra detail (hair, features, clothing, voice, mannerisms) folded into
  // the generated character description in the prompt text.
  description: z.string().optional(),
});
export type CharacterInput = z.infer<typeof characterSchema>;

// Continues the video past Kling's own 15s hard cap by chaining a second Kie.ai job
// ("kling/v3-turbo-image-to-video") seeded from segment 1's actual last frame — real
// visual continuity at the seam, not two unrelated clips stitched together. Kling only:
// this specific continuation model is the only one confirmed to support image-seeded
// generation; Seedance has no equivalent path. Audio has no continuity mechanism
// either way — each segment voices itself independently.
export const part2Schema = z.object({
  action: z.string().min(1).max(2500),
  durationSeconds: z.number().int().min(3).max(15),
  resolution: z.enum(["720p", "1080p"]).optional(),
});
export type Part2Input = z.infer<typeof part2Schema>;

export const videoGenerationRequestSchema = z
  .object({
    brand: recordSchema.optional(),
    product: recordSchema.optional(),
    // Product photos double as Seedance's `reference_image_urls` — its mechanism for
    // both product fidelity and (if a character photo is ever added here) character
    // consistency, replacing Sora's free-text-only / character-tag approach.
    productShots: z.array(z.string()).optional().default([]),
    character: characterSchema.optional(),
    location: z.string().optional(),
    scenes: z.array(videoSceneSchema).min(1).max(6),
    // Which video generation backend to use: "seedance-2-5" (default — ByteDance's
    // newer flagship, single continuous-take model but natively reaches 30s in one
    // call and beats both other options on quality/consistency, confirmed via this
    // app's own live testing plus independent leaderboards), "seedance" (the original
    // Seedance 2.0 integration, kept as a cheaper/legacy option, 15s ceiling), or
    // "kling-o3" (kling-3.0-omni/text-to-video, real multi-shot storyboarding — see
    // videoGenerationService.ts's buildKlingInput). Strict enum, not a freeform
    // string, so a typo 400s at validation instead of silently falling through.
    model: z.enum(["seedance", "kling-o3", "seedance-2-5"]).optional().default("seedance-2-5"),
    aspectRatio: z.enum(["portrait", "landscape"]).optional().default("portrait"),
    // 480p is meaningfully cheaper on Kie.ai than 720p/1080p (confirmed live: roughly
    // half the per-second cost) — exposed as a real user choice rather than always
    // defaulting to 720p, since Seedance 2.5's cost premium over the other models can
    // burn through credits fast. Kling has no 480p tier of its own (buildKlingInput
    // floors it to 720p); Seedance 2.0's 1080p support is unconfirmed but left
    // available rather than blocked, since Kie.ai's own error is more trustworthy than
    // a guess either way.
    resolution: z.enum(["480p", "720p", "1080p"]).optional().default("720p"),
    customPrompt: z.string().optional(),
    // Which winning-ad blueprint should steer generation: "auto" (default, today's
    // behavior — createVideoTask picks one at random from the brand's vertical pool),
    // "single" (a specific WinningAd the user picked, requires templateId), or
    // "vertical" (a synthesized meta-blueprint combining the whole vertical's pool —
    // see blueprintSynthesisService.ts).
    mode: z.enum(["auto", "single", "vertical"]).optional().default("auto"),
    templateId: z.string().optional(),
    part2: part2Schema.optional(),
    // Pipes the already-built prompt (customPrompt, or buildVideoPrompt's template
    // output) through Claude for a more natural/specific rewrite before it's sent to
    // Kie.ai — see videoPromptService.ts's reworkPromptWithClaude for how the
    // UGC-authenticity/quality-control lines are protected from being altered.
    // Seedance only: Kling's real per-shot content lives in multi_prompt, which this
    // never touches, so it'd be a no-op there rather than doing anything useful.
    useClaudePrompt: z.boolean().optional().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.part2 && data.model !== "kling-o3") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["part2"],
        message: 'part2 continuation requires model: "kling-o3" — Seedance has no confirmed continuation path',
      });
    }
    if (data.useClaudePrompt && data.model === "kling-o3") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["useClaudePrompt"],
        message: "useClaudePrompt only reworks the single continuous prompt Seedance models use — Kling's real content lives in per-shot multi_prompt entries, which this does not touch",
      });
    }
  });
export type VideoGenerationRequestInput = z.infer<typeof videoGenerationRequestSchema>;

// Expands one rough scene idea into a vivid, filmable beat via Claude — model-agnostic,
// since the result just becomes the scene's own `action` text before whichever
// prompt-building path (Seedance's continuous prompt or Kling's per-shot prompts) runs.
export const sceneEnhanceRequestSchema = z.object({
  action: z.string().min(1),
  character: characterSchema.optional(),
  location: z.string().optional(),
  productName: z.string().optional(),
  brandVoice: z.string().optional(),
  // Other scenes' already-written text, so this scene's enhancement doesn't invent a
  // different setting/wardrobe/prop out of thin air — confirmed live: enhancing two
  // scenes independently (no knowledge of each other) produced one in a parked car
  // and one on a couch, a physically impossible jump for a model that renders these
  // as one continuous take, not real cuts. Optional since a scene with no siblings
  // yet (or the first one enhanced) has nothing to stay consistent with.
  otherScenes: z.array(z.string()).optional(),
  // Without this, Claude writes dialogue with no awareness of how many seconds it
  // has to be spoken in — confirmed live: a real generation's two scenes carried
  // ~124 words of dialogue for a 15s total video (natural speech at that word count
  // takes ~50s), forcing the video model to compress delivery to an unnaturally
  // rushed pace to fit it in. Optional so older callers/tests without a duration
  // still work — enhanceSceneAction just skips the word-budget instruction then.
  durationSeconds: z.number().int().min(1).max(30).optional(),
});
export type SceneEnhanceRequestInput = z.infer<typeof sceneEnhanceRequestSchema>;

// Targeted "fix just this" edit on an already-generated video, rather than a full
// reroll — Seedance 2.5 only (confirmed live: feeding an existing video back in via
// reference_video_urls plus an edit-phrased prompt, e.g. "change her sweater to
// blue", makes Kie.ai auto-detect it as a video-editing task and modify only the
// flagged region/element while leaving everything else in the source untouched — no
// separate model or explicit "edit mode" flag needed). Kie.ai requires the source
// video to be 4-30s; shorter clips 400 with a clear error rather than silently
// falling back to a fresh generation.
export const videoEditRequestSchema = z.object({
  sourceVideoUrl: z.string().min(1),
  instruction: z.string().min(1).max(2500),
  resolution: z.enum(["480p", "720p", "1080p"]).optional().default("720p"),
  brandId: z.string().optional(),
});
export type VideoEditRequestInput = z.infer<typeof videoEditRequestSchema>;
