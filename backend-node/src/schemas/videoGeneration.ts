import { z } from "zod";

const recordSchema = z.record(z.string(), z.unknown());

// One beat of dialogue/action within the video. For Seedance (no multi-shot/storyboard
// API) these are concatenated into one continuous prompt by videoGenerationService, so
// the sum of scene durations is what's clamped to its 15s ceiling, not each scene
// alone. For Kling O3 (see `model` below), each scene maps 1:1 onto a real distinct
// shot/cut via its multi_prompt API — same duration-sum ceiling, but up to 6 scenes
// instead of 3 since they're genuinely separate shots, not narrative beats within one
// take. Max bumped from 3 to 6 to allow Kling's real shot count; Seedance-mode callers
// are still expected to stay within 3 (enforced client-side, not re-validated here).
export const videoSceneSchema = z.object({
  durationSeconds: z.number().int().min(1).max(15),
  action: z.string().min(1),
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

export const videoGenerationRequestSchema = z.object({
  brand: recordSchema.optional(),
  product: recordSchema.optional(),
  // Product photos double as Seedance's `reference_image_urls` — its mechanism for
  // both product fidelity and (if a character photo is ever added here) character
  // consistency, replacing Sora's free-text-only / character-tag approach.
  productShots: z.array(z.string()).optional().default([]),
  character: characterSchema.optional(),
  location: z.string().optional(),
  scenes: z.array(videoSceneSchema).min(1).max(6),
  // Which video generation backend to use: "seedance" (default, today's single
  // continuous-take model) or "kling-o3" (kling-3.0-omni/text-to-video, real
  // multi-shot storyboarding — see videoGenerationService.ts's buildKlingInput).
  // Strict enum, not a freeform string, so a typo 400s at validation instead of
  // silently falling through to the Seedance branch.
  model: z.enum(["seedance", "kling-o3"]).optional().default("seedance"),
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
});
export type VideoGenerationRequestInput = z.infer<typeof videoGenerationRequestSchema>;
