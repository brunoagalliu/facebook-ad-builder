import { Router } from "express";

import { prisma } from "../core/prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { validateBody } from "../middleware/validate";
import { deconstructRequestSchema, reconstructRequestSchema } from "../schemas/adBlueprint";
import type { AdBlueprint, BrandData } from "../schemas/adBlueprint";
import { adBlueprintSchema } from "../schemas/adBlueprint";
import { deconstructTemplate, reconstructAd } from "../services/adRemixService";

// No auth on this router, matching the Python source (ad_remix.py has zero auth deps).
const router = Router();

router.post(
  "/deconstruct",
  validateBody(deconstructRequestSchema),
  asyncHandler(async (req, res) => {
    const { template_id } = req.body as { template_id: string };
    const template = await prisma.winningAd.findUnique({ where: { id: template_id } });
    if (!template) {
      res.status(404).json({ detail: "Template not found" });
      return;
    }

    try {
      const blueprint = await deconstructTemplate(template.imageUrl);
      await prisma.winningAd.update({
        where: { id: template_id },
        data: { blueprintJson: blueprint, blueprintAnalyzedAt: new Date() },
      });
      res.json(blueprint);
    } catch (err) {
      res.status(500).json({ detail: `Deconstruction failed: ${(err as Error).message}` });
    }
  })
);

router.post(
  "/reconstruct",
  validateBody(reconstructRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      template_id: string;
      brand_id: string;
      product_id: string;
      profile_id: string;
      campaign_offer: string;
      campaign_urgency?: string;
      campaign_messaging: string;
    };

    const template = await prisma.winningAd.findUnique({ where: { id: body.template_id } });
    if (!template) {
      res.status(404).json({ detail: "Template not found" });
      return;
    }
    if (!template.blueprintJson) {
      res.status(400).json({ detail: "Template has not been deconstructed yet. Run /deconstruct first." });
      return;
    }

    const brand = await prisma.brand.findUnique({ where: { id: body.brand_id } });
    if (!brand) {
      res.status(404).json({ detail: "Brand not found" });
      return;
    }
    const product = await prisma.product.findUnique({ where: { id: body.product_id } });
    if (!product) {
      res.status(404).json({ detail: "Product not found" });
      return;
    }
    const profile = await prisma.customerProfile.findUnique({ where: { id: body.profile_id } });
    if (!profile) {
      res.status(404).json({ detail: "Customer profile not found" });
      return;
    }

    const brandData: BrandData = {
      brand_name: brand.name,
      brand_voice: brand.voice ?? undefined,
      product_name: product.name,
      product_description: product.description ?? "",
      audience_demographics: profile.demographics ?? "",
      audience_pain_points: profile.painPoints ?? "",
      audience_goals: profile.goals ?? "",
      campaign_offer: body.campaign_offer,
      campaign_urgency: body.campaign_urgency,
      campaign_messaging: body.campaign_messaging,
    };

    const blueprint = adBlueprintSchema.parse(template.blueprintJson);

    try {
      const adConcept = await reconstructAd(blueprint, brandData);
      res.json(adConcept);
    } catch (err) {
      res.status(500).json({ detail: `Reconstruction failed: ${(err as Error).message}` });
    }
  })
);

router.get(
  "/blueprints/:templateId",
  asyncHandler(async (req, res) => {
    const template = await prisma.winningAd.findUnique({ where: { id: req.params.templateId } });
    if (!template) {
      res.status(404).json({ detail: "Template not found" });
      return;
    }
    if (!template.blueprintJson) {
      res.status(404).json({ detail: "Template has not been deconstructed yet" });
      return;
    }
    res.json(template.blueprintJson as unknown as AdBlueprint);
  })
);

router.get(
  "/blueprints",
  asyncHandler(async (_req, res) => {
    // Filtered in application code rather than the query — Prisma's JSON-null
    // filtering (Prisma.JsonNull vs DbNull vs plain null) is fiddly enough across
    // versions that this is simpler and less error-prone for a table this size.
    const templates = await prisma.winningAd.findMany();
    res.json(
      templates
        .filter((t) => t.blueprintJson !== null)
        .map((t) => ({
          template_id: t.id,
          template_name: t.name,
          blueprint: t.blueprintJson,
          analyzed_at: t.blueprintAnalyzedAt,
        }))
    );
  })
);

export default router;
