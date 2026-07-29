import { z } from "zod";

const recordSchema = z.record(z.string(), z.unknown());

export const copyGenerationRequestSchema = z.object({
  brand: recordSchema,
  product: recordSchema,
  profile: recordSchema,
  template: recordSchema.optional(),
  variationCount: z.number().optional().default(3),
  campaignDetails: z.record(z.string(), z.string()),
  customPrompt: z.string().optional(),
});
export type CopyGenerationRequestInput = z.infer<typeof copyGenerationRequestSchema>;

export const fieldRegenerationRequestSchema = z.object({
  field: z.string(),
  currentValue: z.string(),
  brand: recordSchema,
  product: recordSchema,
  profile: recordSchema,
  template: recordSchema.optional(),
  campaignDetails: z.record(z.string(), z.string()),
});
export type FieldRegenerationRequestInput = z.infer<typeof fieldRegenerationRequestSchema>;
