import { z } from "zod";

export const adSearchRequestSchema = z.object({
  query: z.string(),
  platform: z.string().optional().default("facebook"),
  limit: z.number().optional().default(10),
  country: z.string().optional().default("US"),
  offset: z.number().optional().default(0),
  exclude_ids: z.array(z.string()).optional().default([]),
  negative_keywords: z.array(z.string()).optional().default([]),
  vertical_id: z.string().optional(),
  search_type: z.string().optional().default("one_time"),
  schedule_config: z.record(z.string(), z.unknown()).optional(),
});
export type AdSearchRequestInput = z.infer<typeof adSearchRequestSchema>;

export const brandScrapeCreateSchema = z.object({
  brand_name: z.string(),
  page_url: z.string(),
});
export type BrandScrapeCreateInput = z.infer<typeof brandScrapeCreateSchema>;
