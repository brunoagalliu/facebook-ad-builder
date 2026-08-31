import type { GeneratedAd } from "@prisma/client";
import { Router } from "express";

import { prisma } from "../core/prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth, requirePermission } from "../middleware/auth";
import { validateBody } from "../middleware/validate";
import { BatchSaveRequestInput, batchSaveRequestSchema, imageGenerationRequestSchema } from "../schemas/generatedAd";
import { videoGenerationRequestSchema } from "../schemas/videoGeneration";
import { AdBlueprint } from "../schemas/adBlueprint";
import { VideoBlueprint } from "../schemas/videoBlueprint";
import { getCandidateBlueprintsForVertical, selectBlueprintForBrand, selectVideoBlueprintForBrand } from "../services/blueprintSelectionService";
import { synthesizeVerticalImageBlueprint, synthesizeVerticalVideoBlueprint } from "../services/blueprintSynthesisService";
import { generateImages } from "../services/imageGenerationService";
import { createVideoTask, downloadAndSaveVideo, getVideoTaskStatus } from "../services/videoGenerationService";
import { serialize as serializeWinningAd } from "./templates";

const router = Router();

router.post(
  "/generate-image",
  requirePermission("ads:write"),
  validateBody(imageGenerationRequestSchema),
  asyncHandler(async (req, res) => {
    try {
      const images = await generateImages(req.body);
      res.json({ images });
    } catch (err) {
      // A total generation failure (e.g. Fal.ai account/billing issue) — surface the
      // real cause instead of letting it fall through to the generic 500 handler.
      res.status(502).json({ detail: (err as Error).message || "Image generation failed" });
    }
  })
);

// A synthesized meta-blueprint (blueprintSynthesisService.ts) isn't a real persisted
// WinningAd row, so it can't go through templates.ts's serialize() — this covers just
// the fields the frontend's template consumers (ImageAds.jsx/VideoAds.jsx) actually
// read (blueprint_json/video_blueprint_json/media_type), plus source_count so the UI
// can show "synthesized from N winning ads".
function serializeSynthesizedBlueprint(
  verticalId: string,
  verticalName: string,
  mediaType: "image" | "video",
  blueprint: AdBlueprint | VideoBlueprint,
  sourceCount: number
) {
  return {
    id: `synthesis:${verticalId}:${mediaType}`,
    name: `${verticalName} — Vertical Blueprint (${sourceCount} ads)`,
    image_url: null,
    media_type: mediaType,
    blueprint_json: mediaType === "image" ? blueprint : null,
    video_blueprint_json: mediaType === "video" ? blueprint : null,
    source_count: sourceCount,
  };
}

// Auto-picks the best-fitting WinningAd blueprint for a brand's vertical
// (blueprintSelectionService.ts) — lets the wizard pre-fill a template instead of
// forcing the user through manual browsing every time. Returns null (not 404) when
// the brand has no vertical or the vertical has no analyzed blueprints yet — this is
// an optional smart default, not a required lookup. mode=vertical instead synthesizes
// a meta-blueprint across the whole vertical's pool (blueprintSynthesisService.ts) —
// default mode=auto keeps today's single-random-pick behavior, fully backward
// compatible for any existing caller that doesn't send a mode.
router.get(
  "/auto-template",
  requireAuth,
  asyncHandler(async (req, res) => {
    const brandId = req.query.brand_id as string | undefined;
    if (!brandId) {
      res.status(422).json({ detail: "brand_id is required" });
      return;
    }
    if (req.query.mode === "vertical") {
      const brand = await prisma.brand.findUnique({ where: { id: brandId }, include: { vertical: true } });
      if (!brand?.verticalId || !brand.vertical) {
        res.json(null);
        return;
      }
      const [blueprint, candidates] = await Promise.all([
        synthesizeVerticalImageBlueprint(brand.verticalId),
        getCandidateBlueprintsForVertical(brand.verticalId, "image"),
      ]);
      res.json(
        blueprint ? serializeSynthesizedBlueprint(brand.verticalId, brand.vertical.name, "image", blueprint, candidates.length) : null
      );
      return;
    }
    const blueprint = await selectBlueprintForBrand(brandId);
    res.json(blueprint ? serializeWinningAd(blueprint) : null);
  })
);

// Video counterpart of the above — createVideoTask already calls
// selectVideoBlueprintForBrand internally to steer generation, but that pick was never
// exposed to the frontend, so the wizard had no way to show or pull from it (unlike
// the image wizard's auto-suggested template). Same "return null, not 404" contract,
// same mode=vertical extension.
router.get(
  "/auto-video-template",
  requireAuth,
  asyncHandler(async (req, res) => {
    const brandId = req.query.brand_id as string | undefined;
    if (!brandId) {
      res.status(422).json({ detail: "brand_id is required" });
      return;
    }
    if (req.query.mode === "vertical") {
      const brand = await prisma.brand.findUnique({ where: { id: brandId }, include: { vertical: true } });
      if (!brand?.verticalId || !brand.vertical) {
        res.json(null);
        return;
      }
      const [blueprint, candidates] = await Promise.all([
        synthesizeVerticalVideoBlueprint(brand.verticalId),
        getCandidateBlueprintsForVertical(brand.verticalId, "video"),
      ]);
      res.json(
        blueprint ? serializeSynthesizedBlueprint(brand.verticalId, brand.vertical.name, "video", blueprint, candidates.length) : null
      );
      return;
    }
    const blueprint = await selectVideoBlueprintForBrand(brandId);
    res.json(blueprint ? serializeWinningAd(blueprint) : null);
  })
);

// Starts an async Kie.ai/Sora video generation job. The frontend polls
// GET /generate-video/:taskId until it gets a terminal state.
router.post(
  "/generate-video",
  requirePermission("ads:write"),
  validateBody(videoGenerationRequestSchema),
  asyncHandler(async (req, res) => {
    try {
      const taskId = await createVideoTask(req.body);
      res.json({ task_id: taskId });
    } catch (err) {
      res.status(502).json({ detail: (err as Error).message || "Video generation failed to start" });
    }
  })
);

// Poll for job status. On first observing "success", downloads and persists the
// result before Kie.ai's 24h result-URL expiry — callers must stop polling once a
// terminal state (success/fail) comes back, since a second poll after success would
// re-download and duplicate-store the same video.
router.get(
  "/generate-video/:taskId",
  requireAuth,
  asyncHandler(async (req, res) => {
    try {
      const status = await getVideoTaskStatus(req.params.taskId);
      if (status.state === "success" && status.resultUrl) {
        const videoUrl = await downloadAndSaveVideo(status.resultUrl);
        res.json({ state: status.state, video_url: videoUrl });
        return;
      }
      res.json({ state: status.state, progress: status.progress, detail: status.failMsg });
    } catch (err) {
      res.status(502).json({ detail: (err as Error).message || "Failed to fetch video status" });
    }
  })
);

function serialize(ad: GeneratedAd) {
  return {
    id: ad.id,
    brand_id: ad.brandId,
    product_id: ad.productId,
    template_id: ad.templateId,
    image_url: ad.imageUrl,
    headline: ad.headline,
    body: ad.body,
    cta: ad.cta,
    size_name: ad.sizeName,
    dimensions: ad.dimensions,
    prompt: ad.prompt,
    ad_bundle_id: ad.adBundleId,
    created_at: ad.createdAt ? ad.createdAt.toISOString() : null,
    media_type: ad.mediaType || "image",
    video_url: ad.videoUrl,
    video_id: ad.videoId,
    thumbnail_url: ad.thumbnailUrl,
  };
}

router.get(
  "",
  requireAuth,
  asyncHandler(async (req, res) => {
    const brandId = req.query.brand_id as string | undefined;
    const ads = await prisma.generatedAd.findMany({
      where: brandId ? { brandId } : undefined,
      orderBy: { createdAt: "desc" },
    });
    res.json(ads.map(serialize));
  })
);

router.delete(
  "/:adId",
  requirePermission("ads:delete"),
  asyncHandler(async (req, res) => {
    const ad = await prisma.generatedAd.findUnique({ where: { id: req.params.adId } });
    if (!ad) {
      res.status(404).json({ detail: "Ad not found" });
      return;
    }
    await prisma.generatedAd.delete({ where: { id: req.params.adId } });
    res.json({ message: "Ad deleted successfully" });
  })
);

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

router.post(
  "/export-csv",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ids = (req.body?.ids ?? []) as string[];
    if (!ids.length) {
      res.status(400).json({ detail: "No ad IDs provided" });
      return;
    }
    const ads = await prisma.generatedAd.findMany({ where: { id: { in: ids } } });

    const header = [
      "ID",
      "Brand ID",
      "Headline",
      "Body",
      "CTA",
      "Size",
      "Dimensions",
      "Media Type",
      "Image URL",
      "Video URL",
      "Video ID",
      "Thumbnail URL",
      "Created At",
    ];
    const rows = ads.map((ad) =>
      [
        ad.id,
        ad.brandId ?? "",
        ad.headline ?? "",
        ad.body ?? "",
        ad.cta ?? "",
        ad.sizeName ?? "",
        ad.dimensions ?? "",
        ad.mediaType ?? "image",
        ad.imageUrl ?? "",
        ad.videoUrl ?? "",
        ad.videoId ?? "",
        ad.thumbnailUrl ?? "",
        ad.createdAt ? ad.createdAt.toISOString() : "",
      ]
        .map(csvField)
        .join(",")
    );
    const csv = [header.map(csvField).join(","), ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=generated-ads.csv");
    res.send(csv);
  })
);

router.post(
  "/batch",
  requirePermission("ads:write"),
  validateBody(batchSaveRequestSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as BatchSaveRequestInput;
    let savedCount = 0;

    try {
      for (const adData of body.ads) {
        const existing = await prisma.generatedAd.findUnique({ where: { id: adData.id } });
        if (existing) continue;

        await prisma.generatedAd.create({
          data: {
            id: adData.id,
            brandId: adData.brandId,
            productId: adData.productId,
            templateId: adData.templateId,
            imageUrl: adData.imageUrl,
            headline: adData.headline,
            body: adData.body,
            cta: adData.cta,
            sizeName: adData.sizeName,
            dimensions: adData.dimensions,
            prompt: adData.prompt,
            adBundleId: adData.adBundleId,
            mediaType: adData.mediaType || "image",
            videoUrl: adData.videoUrl,
            videoId: adData.videoId,
            thumbnailUrl: adData.thumbnailUrl,
          },
        });
        savedCount++;
      }
      res.json({ message: `Saved ${savedCount} ads`, count: savedCount });
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

export default router;
