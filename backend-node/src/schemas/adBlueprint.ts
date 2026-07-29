import { z } from "zod";

export const adBlueprintSchema = z.object({
  layout_framework: z.string(),
  narrative_arc: z.string(),
  text_hierarchy: z.string(),
  psychological_triggers: z.array(z.string()),
  visual_style_guide: z.string(),
});
export type AdBlueprint = z.infer<typeof adBlueprintSchema>;

export const adConceptSchema = z.object({
  headline_remix: z.string(),
  visual_description: z.string(),
  body_copy: z.string(),
  cta_button: z.string(),
  image_generation_prompt: z.string(),
});
export type AdConcept = z.infer<typeof adConceptSchema>;

export interface BrandData {
  brand_name: string;
  brand_voice?: string;
  product_name: string;
  product_description: string;
  audience_demographics: string;
  audience_pain_points?: string;
  audience_goals?: string;
  campaign_offer: string;
  campaign_urgency?: string;
  campaign_messaging: string;
}

// template_id/brand_id/product_id/profile_id are UUID strings (matching every other
// model's primary key in this app) — the Python schema had these typed `int`, which
// meant /deconstruct and /reconstruct 422'd on every real request since the frontend
// always sends UUID strings. Fixed here rather than ported forward.
export const deconstructRequestSchema = z.object({
  template_id: z.string(),
});
export type DeconstructRequestInput = z.infer<typeof deconstructRequestSchema>;

export const reconstructRequestSchema = z.object({
  template_id: z.string(),
  brand_id: z.string(),
  product_id: z.string(),
  profile_id: z.string(),
  campaign_offer: z.string(),
  campaign_urgency: z.string().optional(),
  campaign_messaging: z.string(),
});
export type ReconstructRequestInput = z.infer<typeof reconstructRequestSchema>;
