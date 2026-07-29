import { z } from "zod";

export const adStyleCreateSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string().optional(),
  best_for: z.array(z.string()).optional(),
  visual_layout: z.string().optional(),
  psychology: z.string().optional(),
  mood: z.string().optional(),
  lighting: z.string().optional(),
  composition: z.string().optional(),
  design_style: z.string().optional(),
  prompt: z.string().optional(),
});
export type AdStyleCreateInput = z.infer<typeof adStyleCreateSchema>;

export const adStyleUpdateSchema = adStyleCreateSchema.partial();
export type AdStyleUpdateInput = z.infer<typeof adStyleUpdateSchema>;
