import { Router } from "express";

import { settings } from "../core/config";
import { asyncHandler } from "../middleware/asyncHandler";
import { validateBody } from "../middleware/validate";
import {
  CopyGenerationRequestInput,
  FieldRegenerationRequestInput,
  copyGenerationRequestSchema,
  fieldRegenerationRequestSchema,
} from "../schemas/copyGeneration";
import * as copyGenerationService from "../services/copyGenerationService";

const router = Router();

router.post(
  "/generate",
  validateBody(copyGenerationRequestSchema),
  asyncHandler(async (req, res) => {
    if (!settings.ANTHROPIC_API_KEY) {
      res.status(500).json({ detail: "Anthropic API key not configured" });
      return;
    }
    const body = req.body as CopyGenerationRequestInput;
    try {
      const result = await copyGenerationService.generateVariations({
        brand: body.brand,
        product: body.product,
        profile: body.profile,
        campaignDetails: body.campaignDetails,
        template: body.template,
        variationCount: body.variationCount,
        customPrompt: body.customPrompt,
      });
      res.json(result);
    } catch (err) {
      if (err instanceof SyntaxError) {
        res.status(500).json({ detail: `Failed to parse AI response as JSON: ${err.message}` });
        return;
      }
      res.status(500).json({ detail: `Copy generation failed: ${(err as Error).message}` });
    }
  })
);

router.post(
  "/regenerate-field",
  validateBody(fieldRegenerationRequestSchema),
  asyncHandler(async (req, res) => {
    if (!settings.ANTHROPIC_API_KEY) {
      res.status(500).json({ detail: "Anthropic API key not configured" });
      return;
    }
    const body = req.body as FieldRegenerationRequestInput;
    try {
      const newValue = await copyGenerationService.regenerateField(body);
      res.json({ newValue });
    } catch (err) {
      res.status(500).json({ detail: `Field regeneration failed: ${(err as Error).message}` });
    }
  })
);

export default router;
