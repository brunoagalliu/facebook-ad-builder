import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginJsonSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});
export type LoginJsonInput = z.infer<typeof loginJsonSchema>;

export const refreshSchema = z.object({
  refresh_token: z.string(),
});
export type RefreshInput = z.infer<typeof refreshSchema>;

export const updateMeSchema = z.object({
  name: z.string().optional(),
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;
