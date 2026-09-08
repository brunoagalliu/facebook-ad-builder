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
    resolution: z.enum(["480p", "720p"]).optional().default("720p"),
    customPrompt: z.string().optional(),
    // Which winning-ad blueprint should steer generation: "auto" (default, today's
    // behavior — createVideoTask picks one at random from the brand's vertical pool),
    // "single" (a specific WinningAd the user picked, requires templateId), or
    // "vertical" (a synthesized meta-blueprint combining the whole vertical's pool —
    // see blueprintSynthesisService.ts).
    mode: z.enum(["auto", "single", "vertical"]).optional().default("auto"),
    templateId: z.string().optional(),
    part2: part2Schema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.part2 && data.model !== "kling-o3") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["part2"],
        message: 'part2 continuation requires model: "kling-o3" — Seedance has no confirmed continuation path',
      });
    }
  });
export type VideoGenerationRequestInput = z.infer<typeof videoGenerationRequestSchema>;
