import type { WinningAd } from "@prisma/client";
import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";

import { prisma } from "../core/prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth, requirePermission } from "../middleware/auth";
import { uploadFile } from "../services/storage";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// The original WinningAd Pydantic schema returns snake_case field names matching the
// DB columns directly — Prisma gives us camelCase, so translate back for API parity.
// Exported for reuse by generatedAds.ts's /auto-template (blueprintSelectionService.ts)
// so an auto-selected blueprint round-trips through the exact same shape the frontend
// already handles for a manually-picked one.
export function serialize(t: WinningAd) {
  return {
    id: t.id,
    name: t.name,
    image_url: t.imageUrl,
    notes: t.notes,
    tags: t.tags,
    headline: t.headline,
    body_text: t.bodyText,
    cta_text: t.ctaText,
    analysis: t.analysis,
    recreation_prompt: t.recreationPrompt,
    topic: t.topic,
    mood: t.mood,
    subject_matter: t.subjectMatter,
    copy_analysis: t.copyAnalysis,
    product_name: t.productName,
    category: t.category,
    design_style: t.designStyle,
    filename: t.filename,
    structural_analysis: t.structuralAnalysis,
    layering: t.layering,
    template_structure: t.templateStructure,
    color_palette: t.colorPalette,
    typography_system: t.typographySystem,
    copy_patterns: t.copyPatterns,
    visual_elements: t.visualElements,
    template_category: t.templateCategory,
    blueprint_json: t.blueprintJson,
    blueprint_analyzed_at: t.blueprintAnalyzedAt,
    media_type: t.mediaType,
    video_url: t.videoUrl,
    video_blueprint_json: t.videoBlueprintJson,
    created_at: t.createdAt,
  };
}

router.get(
  "",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { search, category, style, vertical, media_type: mediaType } = req.query as {
      search?: string;
      category?: string;
      style?: string;
      vertical?: string;
      media_type?: string;
    };

    const where: Record<string, unknown> = {};
    if (category) where.templateCategory = category;
    if (style) where.designStyle = style;
    // Distinct from `category` above (that's templateCategory — Auto/Manually
    // promoted/Uploaded, i.e. how a template was created) — `vertical` filters by the
    // niche it was scraped under (WinningAd.category, e.g. "Debt relief"), populated at
    // promotion time from the source scraped ad's search's vertical.
    if (vertical) where.category = vertical;
    // Lets a manual template picker scope to video-capable templates only — added for
    // VideoAds.jsx's single-ad mode (reuses ImageTemplateSelector, which already
    // renders a video badge for these but had no way to filter down to just them).
    if (mediaType) where.mediaType = mediaType;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { tags: { contains: search, mode: "insensitive" } },
        { productName: { contains: search, mode: "insensitive" } },
      ];
    }

    const templates = await prisma.winningAd.findMany({ where });
    res.json(templates.map(serialize));
  })
);

router.get(
  "/filters",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const categories = await prisma.winningAd.findMany({
      where: { templateCategory: { not: null } },
      select: { templateCategory: true },
      distinct: ["templateCategory"],
    });
    const styles = await prisma.winningAd.findMany({
      where: { designStyle: { not: null } },
      select: { designStyle: true },
      distinct: ["designStyle"],
    });
    const verticals = await prisma.winningAd.findMany({
      where: { category: { not: null } },
      select: { category: true },
      distinct: ["category"],
    });
    res.json({
      categories: categories.map((c) => c.templateCategory),
      styles: styles.map((s) => s.designStyle),
      verticals: verticals.map((v) => v.category),
    });
  })
);

router.get(
  "/:id/preview",
  requireAuth,
  asyncHandler(async (req, res) => {
    const template = await prisma.winningAd.findUnique({ where: { id: req.params.id } });
    if (!template) {
      res.status(404).json({ detail: "Template not found" });
      return;
    }
    res.json(serialize(template));
  })
);

// Unlike the Python route (which always wrote to local disk regardless of R2 config —
// a known inconsistency vs uploads.py), this uses the shared storage service so R2
// gets used here too when configured.
router.post(
  "/upload",
  requirePermission("templates:write"),
  upload.array("images"),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    const savedAds = [];
    for (const file of files) {
      const filename = `template_${randomUUID()}_${file.originalname}`;
      const imageUrl = await uploadFile(file.buffer, filename, file.mimetype);
      const newAd = await prisma.winningAd.create({
        data: {
          name: file.originalname,
          imageUrl,
          filename,
          templateCategory: "Uploaded",
          designStyle: "Unknown",
        },
      });
      savedAds.push(newAd);
    }
    res.json({ message: `Successfully uploaded ${savedAds.length} templates`, ads: savedAds.map(serialize) });
  })
);

router.post(
  "/bulk-delete",
  requirePermission("templates:write"),
  asyncHandler(async (req, res) => {
    const ids = (req.body?.ids ?? []) as string[];
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ detail: "No template IDs provided" });
      return;
    }
    const { count } = await prisma.winningAd.deleteMany({ where: { id: { in: ids } } });
    res.json({ message: `Deleted ${count} template${count === 1 ? "" : "s"}`, count });
  })
);

export default router;
