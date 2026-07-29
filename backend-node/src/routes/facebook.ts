import { NextFunction, Request, Response, Router } from "express";

import { prisma } from "../core/prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { requireAuth, requirePermission } from "../middleware/auth";
import * as fb from "../services/facebookService";

// Bodies are untyped (Dict[str, Any] in the Python source, "trust the frontend"
// contract) — kept as-is rather than introducing new validation, per the plan's note
// that this is deliberately not being redesigned in this rewrite.
const router = Router();

// Ports get_facebook_service's init-error handling: surfaces the specific init error
// message as a 500, matching Python, rather than letting it fall through to the app's
// generic error handler (which would flatten it to "Internal server error").
function ensureInitialized(_req: Request, res: Response, next: NextFunction): void {
  try {
    fb.initialize();
    next();
  } catch (err) {
    res.status(500).json({ detail: (err as Error).message });
  }
}

router.get(
  "/accounts",
  requireAuth,
  ensureInitialized,
  asyncHandler(async (_req, res) => {
    try {
      res.json(await fb.getAdAccounts());
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.get(
  "/campaigns",
  requireAuth,
  ensureInitialized,
  asyncHandler(async (req, res) => {
    try {
      res.json(await fb.getCampaigns(req.query.ad_account_id as string | undefined));
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.post(
  "/campaigns",
  requirePermission("campaigns:write"),
  ensureInitialized,
  asyncHandler(async (req, res) => {
    try {
      res.json(await fb.createCampaign(req.body, req.query.ad_account_id as string | undefined));
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.get(
  "/pixels",
  requireAuth,
  ensureInitialized,
  asyncHandler(async (req, res) => {
    try {
      res.json(await fb.getPixels(req.query.ad_account_id as string | undefined));
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.get(
  "/pages",
  requireAuth,
  ensureInitialized,
  asyncHandler(async (_req, res) => {
    try {
      res.json(await fb.getPages());
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.get(
  "/adsets",
  requireAuth,
  ensureInitialized,
  asyncHandler(async (req, res) => {
    try {
      res.json(await fb.getAdsets(req.query.ad_account_id as string | undefined, req.query.campaign_id as string | undefined));
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.post(
  "/adsets",
  requirePermission("campaigns:write"),
  ensureInitialized,
  asyncHandler(async (req, res) => {
    try {
      res.json(await fb.createAdset(req.body, req.query.ad_account_id as string | undefined));
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.post(
  "/creatives",
  requirePermission("campaigns:write"),
  ensureInitialized,
  asyncHandler(async (req, res) => {
    try {
      res.json(await fb.createCreative(req.body, req.query.ad_account_id as string | undefined));
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.post(
  "/ads",
  requirePermission("campaigns:write"),
  ensureInitialized,
  asyncHandler(async (req, res) => {
    try {
      res.json(await fb.createAd(req.body, req.query.ad_account_id as string | undefined));
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.get(
  "/ads",
  requireAuth,
  ensureInitialized,
  asyncHandler(async (req, res) => {
    const adsetId = req.query.adset_id as string | undefined;
    if (!adsetId) {
      res.status(422).json({ detail: "adset_id is required" });
      return;
    }
    try {
      res.json(await fb.getAds(adsetId));
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

// ============= Local-DB persistence only (no live Facebook API calls) =============

router.post(
  "/campaigns/save",
  requirePermission("campaigns:write"),
  asyncHandler(async (req, res) => {
    const data = req.body as Record<string, unknown>;
    try {
      const existing = await prisma.facebookCampaign.findUnique({ where: { id: data.id as string } });
      if (existing) {
        res.json({ message: "Campaign already exists", id: existing.id });
        return;
      }

      const dailyBudgetRaw = data.dailyBudget;
      const dailyBudget = dailyBudgetRaw !== undefined && dailyBudgetRaw !== null ? Math.trunc(Number(dailyBudgetRaw)) : undefined;

      const created = await prisma.facebookCampaign.create({
        data: {
          id: data.id as string,
          name: data.name as string,
          objective: data.objective as string | undefined,
          budgetType: (data.budgetType as string) ?? "ABO",
          dailyBudget,
          bidStrategy: data.bidStrategy as string | undefined,
          status: data.status as string,
          fbCampaignId: data.fbCampaignId as string | undefined,
        },
      });
      res.json({ message: "Campaign saved locally", id: created.id });
    } catch (err) {
      console.error("Error saving campaign locally:", err);
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.post(
  "/adsets/save",
  requirePermission("campaigns:write"),
  asyncHandler(async (req, res) => {
    const data = req.body as Record<string, unknown>;
    try {
      const existing = await prisma.facebookAdSet.findUnique({ where: { id: data.id as string } });
      if (existing) {
        res.json({ message: "AdSet already exists", id: existing.id });
        return;
      }

      const campaignId = data.campaignId as string | undefined;
      if (!campaignId) {
        res.status(400).json({ detail: "campaignId is required" });
        return;
      }

      const dailyBudget = data.dailyBudget !== undefined && data.dailyBudget !== null ? Math.trunc(Number(data.dailyBudget)) : undefined;
      const bidAmount = data.bidAmount !== undefined && data.bidAmount !== null ? Math.trunc(Number(data.bidAmount)) : undefined;

      const created = await prisma.facebookAdSet.create({
        data: {
          id: data.id as string,
          campaignId,
          name: data.name as string,
          optimizationGoal: data.optimizationGoal as string | undefined,
          dailyBudget,
          bidStrategy: data.bidStrategy as string | undefined,
          bidAmount,
          targeting: data.targeting as never,
          pixelId: data.pixelId as string | undefined,
          conversionEvent: data.conversionEvent as string | undefined,
          status: data.status as string,
          fbAdsetId: data.fbAdsetId as string | undefined,
        },
      });
      res.json({ message: "AdSet saved locally", id: created.id });
    } catch (err) {
      console.error("Error saving adset locally:", err);
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.post(
  "/ads/save",
  requirePermission("campaigns:write"),
  asyncHandler(async (req, res) => {
    const data = req.body as Record<string, unknown>;
    try {
      const created = await prisma.facebookAd.create({
        data: {
          id: data.id as string,
          adsetId: data.adsetId as string,
          name: data.name as string,
          creativeName: data.creativeName as string | undefined,
          imageUrl: data.imageUrl as string | undefined,
          mediaType: (data.mediaType as string) ?? "image",
          videoUrl: data.videoUrl as string | undefined,
          videoId: data.videoId as string | undefined,
          thumbnailUrl: data.thumbnailUrl as string | undefined,
          bodies: data.bodies as never,
          headlines: data.headlines as never,
          description: data.description as string | undefined,
          cta: data.cta as string | undefined,
          websiteUrl: data.websiteUrl as string | undefined,
          status: data.status as string,
          fbAdId: data.fbAdId as string | undefined,
          fbCreativeId: data.fbCreativeId as string | undefined,
        },
      });
      res.json({ message: "Ad saved locally", id: created.id });
    } catch (err) {
      console.error("Error saving ad locally:", err);
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

// ============= Media upload (real Facebook API calls) =============

router.post(
  "/upload-image",
  requirePermission("campaigns:write"),
  ensureInitialized,
  asyncHandler(async (req, res) => {
    const imageUrl = req.body?.image_url as string | undefined;
    if (!imageUrl) {
      res.status(400).json({ detail: "image_url is required" });
      return;
    }
    try {
      const imageHash = await fb.uploadImage(imageUrl, req.query.ad_account_id as string | undefined);
      res.json({ image_hash: imageHash });
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.post(
  "/upload-video",
  requirePermission("campaigns:write"),
  ensureInitialized,
  asyncHandler(async (req, res) => {
    const videoUrl = req.body?.video_url as string | undefined;
    if (!videoUrl) {
      res.status(400).json({ detail: "video_url is required" });
      return;
    }
    try {
      const waitForReady = req.body?.wait_for_ready ?? true;
      const timeout = req.body?.timeout ?? 600;
      const result = await fb.uploadVideo(videoUrl, req.query.ad_account_id as string | undefined, waitForReady, timeout);
      res.json(result);
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.get(
  "/video-status/:videoId",
  requireAuth,
  ensureInitialized,
  asyncHandler(async (req, res) => {
    try {
      res.json(await fb.getVideoStatus(req.params.videoId));
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.get(
  "/video-thumbnails/:videoId",
  requireAuth,
  ensureInitialized,
  asyncHandler(async (req, res) => {
    try {
      res.json({ thumbnails: await fb.getVideoThumbnails(req.params.videoId) });
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

router.get(
  "/locations/search",
  requireAuth,
  ensureInitialized,
  asyncHandler(async (req, res) => {
    const q = req.query.q as string | undefined;
    if (!q) {
      res.status(422).json({ detail: "q is required" });
      return;
    }
    try {
      const type = (req.query.type as string) ?? "city";
      const limit = Number(req.query.limit ?? 10);
      res.json(await fb.searchLocations(q, type, limit, req.query.ad_account_id as string | undefined));
    } catch (err) {
      res.status(500).json({ detail: (err as Error).message });
    }
  })
);

export default router;
