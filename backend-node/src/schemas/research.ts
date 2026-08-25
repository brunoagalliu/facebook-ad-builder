import { z } from "zod";

// .nullish() (not .optional()) wherever the frontend can send an explicit `null` —
// ported from Python's `Optional[X] = None`, which (unlike Zod's .optional()) accepts
// both a missing key AND an explicit null. Confirmed against Research.jsx, which sends
// `vertical_id: selectedVertical?.id || null` and `schedule_config: null` literally.
export const adSearchRequestSchema = z.object({
  query: z.string(),
  source: z.enum(["facebook", "adplexity"]).nullish().default("facebook"),
  platform: z.string().nullish().default("facebook"),
  limit: z.number().nullish().default(10),
  country: z.string().nullish().default("US"),
  offset: z.number().nullish().default(0),
  exclude_ids: z.array(z.string()).nullish().default([]),
  negative_keywords: z.array(z.string()).nullish().default([]),
  vertical_id: z.string().nullish(),
  search_type: z.string().nullish().default("one_time"),
  schedule_config: z.record(z.string(), z.unknown()).nullish(),
});
export type AdSearchRequestInput = z.infer<typeof adSearchRequestSchema>;

export const brandScrapeCreateSchema = z.object({
  brand_name: z.string(),
  page_url: z.string(),
});

export const batchDeletePagesSchema = z.object({
  page_ids: z.array(z.string()).min(1),
});
export type BatchDeletePagesInput = z.infer<typeof batchDeletePagesSchema>;
export type BrandScrapeCreateInput = z.infer<typeof brandScrapeCreateSchema>;
