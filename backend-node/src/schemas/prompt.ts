import { z } from "zod";

export const promptCreateSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  description: z.string().optional(),
  variables: z.array(z.string()).optional(),
  template: z.string(),
  notes: z.string().optional(),
});
export type PromptCreateInput = z.infer<typeof promptCreateSchema>;

export const promptUpdateSchema = promptCreateSchema.partial();
export type PromptUpdateInput = z.infer<typeof promptUpdateSchema>;
