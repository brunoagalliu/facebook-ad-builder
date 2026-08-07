import { z } from "zod";

export const brandColorsSchema = z.object({
  primary: z.string(),
  secondary: z.string(),
  highlight: z.string(),
});

// Nested product shape used when creating/updating a brand (no brandId — it's implied).
// .nullish() (not .optional()) on nullable-in-DB fields — BrandForm.jsx round-trips
// existing records (load -> edit -> resubmit) with no transform in between, so a NULL
// value already in the DB flows straight back out as a literal `null` in the request.
const nestedProductSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  description: z.string().nullish(),
  product_shots: z.array(z.string()).optional().default([]),
});

export const brandCreateSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  logo: z.string().nullish(),
  voice: z.string().nullish(),
  colors: brandColorsSchema,
  products: z.array(nestedProductSchema).optional().default([]),
  profileIds: z.array(z.string()).optional().default([]),
  // Optional — lets image/video generation auto-pick the best-fitting WinningAd
  // blueprint for this brand instead of requiring manual template browsing every time.
  verticalId: z.string().nullish(),
});
export type BrandCreateInput = z.infer<typeof brandCreateSchema>;

// BrandUpdate is identical in shape to BrandCreate in the Python app.
export const brandUpdateSchema = brandCreateSchema;
