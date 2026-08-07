import { z } from "zod";

const recordSchema = z.record(z.string(), z.unknown());

// One beat of dialogue/action within the video. Kie.ai's sora-2-pro-storyboard model
// takes an ordered `shots` array, each up to 15s, totaling 25s max (per Kie.ai's docs
// and confirmed by every worked example in the course material this was built from).
export const videoSceneSchema = z.object({
  durationSeconds: z.number().int().min(5).max(15),
  action: z.string().min(1),
});
export type VideoSceneInput = z.infer<typeof videoSceneSchema>;

export const characterSchema = z.object({
  // An existing Sora-generated character handle (e.g. "@icyflame313"), created once
  // via the Sora app and reused across videos for guaranteed visual consistency. When
  // present this replaces the full text description below (see videoGenerationService).
  tag: z.string().optional(),
  name: z.string().optional(),
  age: z.string().optional(),
  ethnicity: z.string().optional(),
  gender: z.string().optional(),
  // Free-form extra detail (hair, features, clothing, voice, mannerisms) folded into
  // the generated character description when no tag is supplied.
  description: z.string().optional(),
});
export type CharacterInput = z.infer<typeof characterSchema>;

export const videoGenerationRequestSchema = z.object({
  brand: recordSchema.optional(),
  product: recordSchema.optional(),
  productShots: z.array(z.string()).optional().default([]),
  character: characterSchema.optional(),
  location: z.string().optional(),
  scenes: z.array(videoSceneSchema).min(1).max(3),
  aspectRatio: z.enum(["portrait", "landscape"]).optional().default("portrait"),
  removeWatermark: z.boolean().optional().default(true),
  customPrompt: z.string().optional(),
});
export type VideoGenerationRequestInput = z.infer<typeof videoGenerationRequestSchema>;
