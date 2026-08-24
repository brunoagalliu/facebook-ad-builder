import { Router } from "express";

import { prisma } from "../core/prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { checkAdsLibraryTokenStatus } from "../services/scraperService";

// No auth on this router, matching the Python source (dashboard.py has zero auth deps).
const router = Router();

router.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const [brandsCount, productsCount, generatedAdsCount, templatesCount, campaignsCount] = await Promise.all([
      prisma.brand.count(),
      prisma.product.count(),
      prisma.generatedAd.count(),
      prisma.winningAd.count(),
      prisma.facebookCampaign.count(),
    ]);
    res.json({
      brands_count: brandsCount,
      products_count: productsCount,
      generated_ads_count: generatedAdsCount,
      templates_count: templatesCount,
      campaigns_count: campaignsCount,
    });
  })
);

router.get(
  "/facebook-token-status",
  asyncHandler(async (_req, res) => {
    const status = await checkAdsLibraryTokenStatus();
    res.json(status);
  })
);

export default router;
