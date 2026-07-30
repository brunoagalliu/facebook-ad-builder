import { z } from "zod";

export const adStyleCreateSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string().nullish(),
  best_for: z.array(z.string()).nullish(),
  visual_layout: z.string().nullish(),
  psychology: z.string().nullish(),
  mood: z.string().nullish(),
  lighting: z.string().nullish(),
  composition: z.string().nullish(),
  design_style: z.string().nullish(),
  prompt: z.string().nullish(),
});
export type AdStyleCreateInput = z.infer<typeof adStyleCreateSchema>;

export const adStyleUpdateSchema = adStyleCreateSchema.partial();
export type AdStyleUpdateInput = z.infer<typeof adStyleUpdateSchema>;
