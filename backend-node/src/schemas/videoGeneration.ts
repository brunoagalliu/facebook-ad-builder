import { z } from "zod";

const recordSchema = z.record(z.string(), z.unknown());

// One beat of dialogue/action within the video. Kie.ai's bytedance/seedance-2 model
// takes a single prompt + duration per call (no multi-shot/storyboard API, unlike
// Sora or Kling) — up to 15s total, confirmed against the model's own live parameter
// schema (embedded in kie.ai/seedance-2-0's page data: duration min 4 max 15). Scenes
// are concatenated into one continuous prompt by videoGenerationService, so the sum
// of scene durations is what's clamped to that 15s ceiling, not each scene alone.
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
  scenes: z.array(videoSceneSchema).min(1).max(3),
  aspectRatio: z.enum(["portrait", "landscape"]).optional().default("portrait"),
  resolution: z.enum(["480p", "720p"]).optional().default("720p"),
  customPrompt: z.string().optional(),
});
export type VideoGenerationRequestInput = z.infer<typeof videoGenerationRequestSchema>;
