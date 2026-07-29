import { z } from "zod";

export const profileBaseSchema = z.object({
  name: z.string(),
  demographics: z.string().optional().default(""),
  painPoints: z.string().optional().default(""),
  goals: z.string().optional().default(""),
});

export const profileCreateSchema = profileBaseSchema.extend({
  id: z.string().optional(),
});
export type ProfileCreateInput = z.infer<typeof profileCreateSchema>;
export type ProfileBaseInput = z.infer<typeof profileBaseSchema>;
