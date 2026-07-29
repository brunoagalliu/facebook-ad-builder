import { z } from "zod";

const recordSchema = z.record(z.string(), z.unknown());

export const imageGenerationRequestSchema = z.object({
  template: recordSchema.optional(),
  brand: recordSchema.optional(),
  product: recordSchema.optional(),
  copy: recordSchema.optional(),
  count: z.number().optional().default(1),
  imageSizes: z.array(recordSchema).optional().default([]),
  resolution: z.string().optional().default("1K"),
  productShots: z.array(z.string()).optional().default([]),
  model: z.string().optional().default("nano-banana-pro"),
  customPrompt: z.string().optional(),
  useProductImage: z.boolean().optional().default(false),
});
export type ImageGenerationRequestInput = z.infer<typeof imageGenerationRequestSchema>;

export const generatedAdCreateSchema = z.object({
  id: z.string(),
  brandId: z.string().optional(),
  productId: z.string().optional(),
  templateId: z.string().optional(),
  imageUrl: z.string().optional(),
  headline: z.string().optional(),
  body: z.string().optional(),
  cta: z.string().optional(),
  sizeName: z.string().optional(),
  dimensions: z.string().optional(),
  prompt: z.string().optional(),
  adBundleId: z.string().optional(),
  mediaType: z.string().optional().default("image"),
  videoUrl: z.string().optional(),
  videoId: z.string().optional(),
  thumbnailUrl: z.string().optional(),
});
export type GeneratedAdCreateInput = z.infer<typeof generatedAdCreateSchema>;

export const batchSaveRequestSchema = z.object({
  ads: z.array(generatedAdCreateSchema),
});
export type BatchSaveRequestInput = z.infer<typeof batchSaveRequestSchema>;
