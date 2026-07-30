import { Router } from "express";

import { prisma } from "../core/prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { validateBody } from "../middleware/validate";
import { AdStyleCreateInput, AdStyleUpdateInput, adStyleCreateSchema, adStyleUpdateSchema } from "../schemas/adStyle";
import { jsonOrDbNull } from "../utils/prismaJson";

// No auth on this router, matching the Python source (ad_styles.py has zero auth deps).
const router = Router();

function serialize(s: {
  id: string;
  name: string;
  category: string;
  description: string | null;
  bestFor: unknown;
  visualLayout: string | null;
  psychology: string | null;
  mood: string | null;
  lighting: string | null;
  composition: string | null;
  designStyle: string | null;
  prompt: string | null;
}) {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    description: s.description,
    best_for: s.bestFor,
    bestFor: s.bestFor, // camelCase alias, matching AdStyleResponse.from_orm
    visual_layout: s.visualLayout,
    visualLayout: s.visualLayout,
    psychology: s.psychology,
    mood: s.mood,
    lighting: s.lighting,
    composition: s.composition,
    design_style: s.designStyle,
    prompt: s.prompt,
  };
}

router.get(
  "",
  asyncHandler(async (req, res) => {
    const category = req.query.category as string | undefined;
    const styles = await prisma.adStyle.findMany(category ? { where: { category } } : undefined);
    res.json(styles.map(serialize));
  })
);

router.get(
  "/:styleId",
  asyncHandler(async (req, res) => {
    const style = await prisma.adStyle.findUnique({ where: { id: req.params.styleId } });
    if (!style) {
      res.status(404).json({ detail: "Ad style not found" });
      return;
    }
    res.json(serialize(style));
  })
);

router.post(
  "",
  validateBody(adStyleCreateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as AdStyleCreateInput;
    const existing = await prisma.adStyle.findUnique({ where: { id: body.id } });
    if (existing) {
      res.status(400).json({ detail: "Ad style with this ID already exists" });
      return;
    }
    const style = await prisma.adStyle.create({
      data: {
        id: body.id,
        name: body.name,
        category: body.category,
        description: body.description,
        bestFor: jsonOrDbNull(body.best_for),
        visualLayout: body.visual_layout,
        psychology: body.psychology,
        mood: body.mood,
        lighting: body.lighting,
        composition: body.composition,
        designStyle: body.design_style,
        prompt: body.prompt,
      },
    });
    res.json(serialize(style));
  })
);

router.put(
  "/:styleId",
  validateBody(adStyleUpdateSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as AdStyleUpdateInput;
    const existing = await prisma.adStyle.findUnique({ where: { id: req.params.styleId } });
    if (!existing) {
      res.status(404).json({ detail: "Ad style not found" });
      return;
    }
    const style = await prisma.adStyle.update({
      where: { id: req.params.styleId },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.category !== undefined ? { category: body.category } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.best_for !== undefined ? { bestFor: jsonOrDbNull(body.best_for) } : {}),
        ...(body.visual_layout !== undefined ? { visualLayout: body.visual_layout } : {}),
        ...(body.psychology !== undefined ? { psychology: body.psychology } : {}),
        ...(body.mood !== undefined ? { mood: body.mood } : {}),
        ...(body.lighting !== undefined ? { lighting: body.lighting } : {}),
        ...(body.composition !== undefined ? { composition: body.composition } : {}),
        ...(body.design_style !== undefined ? { designStyle: body.design_style } : {}),
        ...(body.prompt !== undefined ? { prompt: body.prompt } : {}),
      },
    });
    res.json(serialize(style));
  })
);

router.delete(
  "/:styleId",
  asyncHandler(async (req, res) => {
    const existing = await prisma.adStyle.findUnique({ where: { id: req.params.styleId } });
    if (!existing) {
      res.status(404).json({ detail: "Ad style not found" });
      return;
    }
    await prisma.adStyle.delete({ where: { id: req.params.styleId } });
    res.json({ message: "Ad style deleted successfully" });
  })
);

export default router;
