import { z } from "zod";

export const productCreateSchema = z.object({
  id: z.string().optional(),
  brand_id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  product_shots: z.array(z.string()).optional().default([]),
  default_url: z.string().optional(),
});
export type ProductCreateInput = z.infer<typeof productCreateSchema>;

export const productUpdateSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  product_shots: z.array(z.string()).optional(),
  default_url: z.string().optional(),
});
export type ProductUpdateInput = z.infer<typeof productUpdateSchema>;
