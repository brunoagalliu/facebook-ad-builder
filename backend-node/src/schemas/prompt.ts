import { z } from "zod";

export const promptCreateSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string().nullish(),
  variables: z.array(z.string()).nullish(),
  template: z.string(),
  notes: z.string().nullish(),
});
export type PromptCreateInput = z.infer<typeof promptCreateSchema>;

export const promptUpdateSchema = promptCreateSchema.partial();
export type PromptUpdateInput = z.infer<typeof promptUpdateSchema>;
