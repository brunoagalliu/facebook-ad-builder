import { z } from "zod";

export const screenshotSchema = z.object({
  url: z.string().url(),
});
export type ScreenshotInput = z.infer<typeof screenshotSchema>;
