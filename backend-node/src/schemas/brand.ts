import { z } from "zod";

export const brandColorsSchema = z.object({
  primary: z.string(),
  secondary: z.string(),
  highlight: z.string(),
});

// Nested product shape used when creating/updating a brand (no brandId — it's implied).
const nestedProductSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().optional(),
  product_shots: z.array(z.string()).optional().default([]),
});

export const brandCreateSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  logo: z.string().optional(),
  voice: z.string().optional(),
  colors: brandColorsSchema,
  products: z.array(nestedProductSchema).optional().default([]),
  profileIds: z.array(z.string()).optional().default([]),
});
export type BrandCreateInput = z.infer<typeof brandCreateSchema>;

// BrandUpdate is identical in shape to BrandCreate in the Python app.
export const brandUpdateSchema = brandCreateSchema;
