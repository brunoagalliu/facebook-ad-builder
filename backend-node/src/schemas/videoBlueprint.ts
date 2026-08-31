import { z } from "zod";

// Stage 4's video-native counterpart to adBlueprint.ts's image AdBlueprint — a
// deliberately different shape (hook/pacing/cinematography/dialogue instead of
// layout/visual-style) since a video ad's structure isn't describable in
// image-composition terms. Field names are chosen to map directly onto
// videoGenerationService.ts's Seedance prompt sections (hook_type ties to the
// knowledge-base lead archetypes in 10_lead_archetypes.md; cinematography_style and
// pacing_and_cuts translate near-verbatim into the prompt's Cinematography block).
export const videoBlueprintSchema = z.object({
  hook_transcript: z.string(),
  hook_type: z.string(),
  narrative_arc: z.string(),
  pacing_and_cuts: z.string(),
  cinematography_style: z.string(),
  dialogue_style: z.string(),
  psychological_triggers: z.array(z.string()),
  authenticity_signals: z.array(z.string()),
  // Optional/tolerant, unlike every field above — same reasoning as
  // adBlueprint.ts's detected_category: a freeform-text Gemini response with no
  // structured-output config shouldn't have an occasional omission here nuke the
  // whole blueprint parse.
  detected_category: z.string().nullable().catch(null),
});
export type VideoBlueprint = z.infer<typeof videoBlueprintSchema>;
