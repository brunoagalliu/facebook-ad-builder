import { Router } from "express";

import { prisma } from "../core/prisma";
import { asyncHandler } from "../middleware/asyncHandler";
import { requirePermission } from "../middleware/auth";
import { requireCronSecret } from "../middleware/cronSecret";
import { validateBody } from "../middleware/validate";
import { adSearchRequestSchema, batchDeletePagesSchema, BatchDeletePagesInput, brandScrapeCreateSchema } from "../schemas/research";
import {
  deleteBrandScrape,
  parsePageIdFromUrl,
  parseSearchQueryFromUrl,
  scrapeBrand,
} from "../services/brandScraperService";
import { checkLimit, getUsageStats } from "../services/rateLimiter";
import {
  computeRunDurationDays,
  deleteSavedSearch,
  getSavedSearchWithAds,
  getSavedSearches,
  searchAndSave,
  searchAdsWithoutSaving,
} from "../services/researchService";
import { runScheduledSearches } from "../services/schedulerService";
import { promoteScrapedAd, promoteTopAdsForVertical } from "../services/winnerPromotionService";

const router = Router();

router.post(
  "/search",
  validateBody(adSearchRequestSchema),
  asyncHandler(async (req, res) => {
    const { allowed, resetSeconds } = await checkLimit();
    if (!allowed) {
      res.status(429).json({ detail: `Rate limit exceeded. Try again in ${resetSeconds} seconds.` });
      return;
    }
    const ads = await searchAdsWithoutSaving(req.body);
    res.json(ads);
  })
);

router.post(
  "/search-and-save",
  validateBody(adSearchRequestSchema),
  asyncHandler(async (req, res) => {
    const { allowed, resetSeconds } = await checkLimit();
    if (!allowed) {
      res.status(429).json({ detail: `Rate limit exceeded. Try again in ${resetSeconds} seconds.` });
      return;
    }
    const { savedSearch, savedAds } = await searchAndSave(req.body);
    res.json({
      search_id: savedSearch.id,
      query: savedSearch.query,
      country: savedSearch.country,
      ads_count: savedAds.length,
    });
  })
);

router.get(
  "/saved-searches",
  asyncHandler(async (_req, res) => {
    res.json(await getSavedSearches());
  })
);

router.get(
  "/saved-searches/:searchId",
  asyncHandler(async (req, res) => {
    const search = await getSavedSearchWithAds(req.params.searchId);
    if (!search) {
      res.status(404).json({ detail: "Search not found" });
      return;
    }
    res.json(search);
  })
);

router.delete(
  "/saved-searches/:searchId",
  asyncHandler(async (req, res) => {
    if (await deleteSavedSearch(req.params.searchId)) {
      res.json({ message: "Search deleted" });
      return;
    }
    res.status(404).json({ detail: "Search not found" });
  })
);

router.get(
  "/api-usage",
  asyncHandler(async (_req, res) => {
    const rows = await prisma.apiUsageLog.groupBy({
      by: ["date"],
      _sum: { apiCalls: true, adsReturned: true, adsSaved: true },
      _count: { id: true },
      orderBy: { date: "desc" },
    });
    res.json(
      rows.map((row) => ({
        date: row.date,
        total_calls: row._sum.apiCalls,
        total_returned: row._sum.adsReturned,
        total_saved: row._sum.adsSaved,
        search_count: row._count.id,
      }))
    );
  })
);

router.get(
  "/blacklist",
  asyncHandler(async (_req, res) => {
    const pages = await prisma.pageBlacklist.findMany({ orderBy: { createdAt: "desc" } });
    res.json(pages.map((p) => ({ id: p.id, page_name: p.pageName, reason: p.reason, created_at: p.createdAt.toISOString() })));
  })
);

router.post(
  "/blacklist",
  asyncHandler(async (req, res) => {
    // Python's route declared these as bare scalar function params (not a Pydantic
    // body model), which FastAPI treats as query params by default — the frontend
    // sends them as such (axios `params`, null body). Read from req.query, not req.body.
    const pageName = req.query.page_name as string | undefined;
    const reason = req.query.reason as string | undefined;
    if (!pageName) {
      res.status(422).json({ detail: "page_name is required" });
      return;
    }
    const existing = await prisma.pageBlacklist.findUnique({ where: { pageName } });
    if (existing) {
      res.status(400).json({ detail: "Page already blacklisted" });
      return;
    }
    const entry = await prisma.pageBlacklist.create({ data: { pageName, reason } });
    res.json({ id: entry.id, page_name: entry.pageName, reason: entry.reason, created_at: entry.createdAt.toISOString() });
  })
);

router.delete(
  "/blacklist/:blacklistId",
  asyncHandler(async (req, res) => {
    const existing = await prisma.pageBlacklist.findUnique({ where: { id: req.params.blacklistId } });
    if (!existing) {
      res.status(404).json({ detail: "Blacklist entry not found" });
      return;
    }
    await prisma.pageBlacklist.delete({ where: { id: req.params.blacklistId } });
    res.json({ message: "Removed from blacklist" });
  })
);

router.get(
  "/keyword-blacklist",
  asyncHandler(async (_req, res) => {
    const keywords = await prisma.keywordBlacklist.findMany({ orderBy: { createdAt: "desc" } });
    res.json(keywords.map((k) => ({ id: k.id, keyword: k.keyword, reason: k.reason, created_at: k.createdAt.toISOString() })));
  })
);

router.post(
  "/keyword-blacklist",
  asyncHandler(async (req, res) => {
    // Same query-param convention as /blacklist above — see the comment there.
    const keyword = req.query.keyword as string | undefined;
    const reason = req.query.reason as string | undefined;
    if (!keyword) {
      res.status(422).json({ detail: "keyword is required" });
      return;
    }
    const lower = keyword.toLowerCase();
    const existing = await prisma.keywordBlacklist.findUnique({ where: { keyword: lower } });
    if (existing) {
      res.status(400).json({ detail: "Keyword already blacklisted" });
      return;
    }
    const entry = await prisma.keywordBlacklist.create({ data: { keyword: lower, reason } });
    res.json({ id: entry.id, keyword: entry.keyword, reason: entry.reason, created_at: entry.createdAt.toISOString() });
  })
);

router.delete(
  "/keyword-blacklist/:blacklistId",
  asyncHandler(async (req, res) => {
    const existing = await prisma.keywordBlacklist.findUnique({ where: { id: req.params.blacklistId } });
    if (!existing) {
      res.status(404).json({ detail: "Keyword blacklist entry not found" });
      return;
    }
    await prisma.keywordBlacklist.delete({ where: { id: req.params.blacklistId } });
    res.json({ message: "Removed from keyword blacklist" });
  })
);

router.get(
  "/rate-limit",
  asyncHandler(async (_req, res) => {
    res.json(await getUsageStats());
  })
);

router.get(
  "/facebook-pages",
  asyncHandler(async (req, res) => {
    const limit = Number(req.query.limit ?? 50);
    const offset = Number(req.query.offset ?? 0);
    const sortBy = (req.query.sort_by as string) ?? "total_ads";

    const blacklist = await prisma.pageBlacklist.findMany();
    const blacklistedNames = new Set(blacklist.map((p) => p.pageName.toLowerCase()));

    const orderBy =
      sortBy === "page_name"
        ? { pageName: "asc" as const }
        : sortBy === "last_seen"
          ? { lastSeen: "desc" as const }
          : { totalAds: "desc" as const };

    const pages = await prisma.facebookPage.findMany({ orderBy, skip: offset, take: limit });
    const filtered = pages.filter((p) => !blacklistedNames.has(p.pageName.toLowerCase()));

    const verticals = await prisma.vertical.findMany();
    const verticalMap = new Map(verticals.map((v) => [v.id, v.name]));

    res.json(
      filtered.map((p) => ({
        id: p.id,
        page_name: p.pageName,
        page_url: p.pageUrl,
        total_ads: p.totalAds,
        vertical_id: p.verticalId,
        vertical_name: p.verticalId ? verticalMap.get(p.verticalId) : null,
        first_seen: p.firstSeen ? p.firstSeen.toISOString() : null,
        last_seen: p.lastSeen ? p.lastSeen.toISOString() : null,
      }))
    );
  })
);

router.get(
  "/verticals",
  asyncHandler(async (_req, res) => {
    const verticals = await prisma.vertical.findMany({ orderBy: { name: "asc" } });
    res.json(
      verticals.map((v) => ({
        id: v.id,
        name: v.name,
        description: v.description,
        created_at: v.createdAt ? v.createdAt.toISOString() : null,
      }))
    );
  })
);

router.post(
  "/run-scheduled-searches",
  requireCronSecret,
  asyncHandler(async (_req, res) => {
    await runScheduledSearches();
    res.json({ message: "Scheduled searches completed" });
  })
);

router.post(
  "/verticals",
  asyncHandler(async (req, res) => {
    // Same query-param convention as /blacklist above — see the comment there.
    const name = req.query.name as string | undefined;
    const description = req.query.description as string | undefined;
    if (!name) {
      res.status(422).json({ detail: "name is required" });
      return;
    }
    const existing = await prisma.vertical.findUnique({ where: { name } });
    if (existing) {
      res.status(400).json({ detail: "Vertical already exists" });
      return;
    }
    const vertical = await prisma.vertical.create({ data: { name, description } });
    res.json({
      id: vertical.id,
      name: vertical.name,
      description: vertical.description,
      created_at: vertical.createdAt ? vertical.createdAt.toISOString() : null,
    });
  })
);

// Gated like templates.ts's manual /upload route (also creates WinningAd rows) —
// unlike the rest of this router, which has no auth (matching the original Python app).
router.post(
  "/verticals/:verticalId/promote-winners",
  requirePermission("templates:write"),
  asyncHandler(async (req, res) => {
    const { verticalId } = req.params;
    const vertical = await prisma.vertical.findUnique({ where: { id: verticalId } });
    if (!vertical) {
      res.status(404).json({ detail: "Vertical not found" });
      return;
    }

    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const minRunDurationDays = req.query.min_run_duration_days ? Number(req.query.min_run_duration_days) : undefined;

    try {
      const result = await promoteTopAdsForVertical(verticalId, { limit, minRunDurationDays });
      res.json(result);
    } catch (err) {
      res.status(500).json({ detail: `Promotion failed: ${(err as Error).message}` });
    }
  })
);

// Manual "mark as winner" — lets a user promote a specific scraped ad they've judged
// to be a winner, regardless of what the run-duration heuristic says. Same underlying
// pipeline as the automatic route above, just targeting one ad instead of the top-N
// per vertical.
router.post(
  "/scraped-ads/:scrapedAdId/promote",
  requirePermission("templates:write"),
  asyncHandler(async (req, res) => {
    try {
      const promoted = await promoteScrapedAd(req.params.scrapedAdId, "manual");
      res.json(promoted);
    } catch (err) {
      const message = (err as Error).message;
      const status = message.includes("not found") ? 404 : message.includes("already been promoted") ? 400 : 502;
      res.status(status).json({ detail: message });
    }
  })
);

// Individual-ad removal from the dashboard — distinct from deleteSavedSearch (wipes an
// entire search's results) and page/keyword blacklisting (prevents future scrapes from
// returning matches). This just clears specific already-scraped ads a user has judged
// irrelevant/noise. Safe even for an already-promoted ad: WinningAd.sourceScrapedAdId
// is onDelete: SetNull, so the blueprint survives, it just loses the back-reference.
router.delete(
  "/scraped-ads/:scrapedAdId",
  requirePermission("templates:write"),
  asyncHandler(async (req, res) => {
    const ad = await prisma.scrapedAd.findUnique({ where: { id: req.params.scrapedAdId } });
    if (!ad) {
      res.status(404).json({ detail: "Scraped ad not found" });
      return;
    }
    await prisma.scrapedAd.delete({ where: { id: req.params.scrapedAdId } });
    res.json({ message: "Ad removed" });
  })
);

router.get(
  "/verticals/:verticalId/aggregated-ads",
  asyncHandler(async (req, res) => {
    const { verticalId } = req.params;
    try {
      const searches = await prisma.savedSearch.findMany({ where: { verticalId } });
      const searchIds = searches.map((s) => s.id);
      if (searchIds.length === 0) {
        res.json([]);
        return;
      }

      const blacklist = await prisma.pageBlacklist.findMany();
      const blacklistedNames = new Set(blacklist.map((p) => p.pageName.toLowerCase()));

      const ads = await prisma.scrapedAd.findMany({
        where: { searchId: { in: searchIds }, facebookPageId: { not: null } },
        include: { facebookPage: true },
      });

      const byPage = new Map<
        string,
        { pageName: string; pageId: string; keys: Set<string>; image: number; video: number; carousel: number }
      >();

      for (const ad of ads) {
        if (!ad.facebookPage) continue;
        const key = ad.contentHash ?? ad.id;
        let entry = byPage.get(ad.facebookPage.id);
        if (!entry) {
          entry = { pageName: ad.facebookPage.pageName, pageId: ad.facebookPage.id, keys: new Set(), image: 0, video: 0, carousel: 0 };
          byPage.set(ad.facebookPage.id, entry);
        }
        if (!entry.keys.has(key)) {
          entry.keys.add(key);
          if (ad.mediaType === "image") entry.image++;
          else if (ad.mediaType === "video") entry.video++;
          else if (ad.mediaType === "carousel") entry.carousel++;
        }
      }

      const result = Array.from(byPage.values())
        .filter((e) => !blacklistedNames.has(e.pageName.toLowerCase()))
        .map((e) => ({
          page_name: e.pageName,
          page_id: e.pageId,
          total_ads: e.keys.size,
          image_count: e.image,
          video_count: e.video,
          carousel_count: e.carousel,
        }))
        .sort((a, b) => b.total_ads - a.total_ads);

      res.json(result);
    } catch (err) {
      console.error("Error in aggregated-ads:", err);
      res.status(500).json({ detail: `Error fetching aggregated ads: ${(err as Error).message}` });
    }
  })
);

router.get(
  "/verticals/:verticalId/pages/:pageId/ads",
  asyncHandler(async (req, res) => {
    const { verticalId, pageId } = req.params;
    try {
      const searches = await prisma.savedSearch.findMany({ where: { verticalId } });
      const searchIds = searches.map((s) => s.id);
      if (searchIds.length === 0) {
        res.json([]);
        return;
      }

      const ads = await prisma.scrapedAd.findMany({
        where: { facebookPageId: pageId, searchId: { in: searchIds } },
        orderBy: { createdAt: "desc" },
      });

      // Dedup by content_hash (fallback to id), keeping the earliest-created row per key —
      // matches the Python route's `MIN(id)` grouping.
      const seen = new Map<string, (typeof ads)[number]>();
      for (const ad of ads) {
        const key = ad.contentHash ?? ad.id;
        const existing = seen.get(key);
        if (!existing || ad.id < existing.id) seen.set(key, ad);
      }

      let result = Array.from(seen.values()).map((ad) => ({
        id: ad.id,
        brand_name: ad.brandName,
        headline: ad.headline,
        ad_copy: ad.adCopy,
        cta_text: ad.ctaText,
        media_type: ad.mediaType,
        ad_link: ad.adLink,
        start_date: ad.startDate,
        stop_date: ad.stopDate,
        platforms: ad.platforms,
        seen_count: ad.seenCount ?? 1,
        first_seen: ad.firstSeen ? ad.firstSeen.toISOString() : null,
        last_seen: ad.lastSeen ? ad.lastSeen.toISOString() : null,
        run_duration_days: computeRunDurationDays(ad.startDate, ad.stopDate),
        impressions_lower: ad.impressionsLower,
        impressions_upper: ad.impressionsUpper,
        spend_lower: ad.spendLower,
        spend_upper: ad.spendUpper,
        currency: ad.currency,
      }));

      // "Winning" ads first when requested — run duration is the best proxy this API
      // exposes for ordinary commercial ads (see computeRunDurationDays); nulls (no
      // parseable start_date) sort last rather than first.
      if (req.query.sort_by === "run_duration") {
        result = result.sort((a, b) => (b.run_duration_days ?? -1) - (a.run_duration_days ?? -1));
      }

      res.json(result);
    } catch (err) {
      console.error("Error in page ads:", err);
      res.status(500).json({ detail: `Error fetching page ads: ${(err as Error).message}` });
    }
  })
);

// Bulk version of the single-ad delete above — removes every scraped ad from one page,
// scoped to the current vertical only (a FacebookPage isn't vertical-specific, and
// nuking its ads across every vertical it happens to appear in would be a surprising
// side effect of a button clicked from inside one vertical's view). Same onDelete:
// SetNull safety for already-promoted ads as the single-ad route.
router.delete(
  "/verticals/:verticalId/pages/:pageId/ads",
  requirePermission("templates:write"),
  asyncHandler(async (req, res) => {
    const { verticalId, pageId } = req.params;
    const searches = await prisma.savedSearch.findMany({ where: { verticalId } });
    const searchIds = searches.map((s) => s.id);
    if (searchIds.length === 0) {
      res.json({ message: "Removed 0 ads", count: 0 });
      return;
    }

    const { count } = await prisma.scrapedAd.deleteMany({
      where: { facebookPageId: pageId, searchId: { in: searchIds } },
    });
    res.json({ message: `Removed ${count} ad${count === 1 ? "" : "s"}`, count });
  })
);

// Multi-page version of the above — lets a user clear several spam/irrelevant pages
// (e.g. web-novel ad spam picked up by a broad keyword match) in one action instead of
// one Delete-All-Ads click per page. Same vertical-scoping and onDelete: SetNull safety.
router.delete(
  "/verticals/:verticalId/pages/ads",
  requirePermission("templates:write"),
  validateBody(batchDeletePagesSchema),
  asyncHandler(async (req, res) => {
    const { verticalId } = req.params;
    const { page_ids: pageIds } = req.body as BatchDeletePagesInput;

    const searches = await prisma.savedSearch.findMany({ where: { verticalId } });
    const searchIds = searches.map((s) => s.id);
    if (searchIds.length === 0) {
      res.json({ message: "Removed 0 ads", count: 0 });
      return;
    }

    const { count } = await prisma.scrapedAd.deleteMany({
      where: { facebookPageId: { in: pageIds }, searchId: { in: searchIds } },
    });
    res.json({ message: `Removed ${count} ad${count === 1 ? "" : "s"} across ${pageIds.length} page${pageIds.length === 1 ? "" : "s"}`, count });
  })
);

// ============= Brand Scrape Endpoints =============

router.post(
  "/brand-scrapes",
  validateBody(brandScrapeCreateSchema),
  asyncHandler(async (req, res) => {
    const { brand_name: brandName, page_url: pageUrl } = req.body as { brand_name: string; page_url: string };

    const pageId = parsePageIdFromUrl(pageUrl);
    const searchQuery = parseSearchQueryFromUrl(pageUrl);
    if (!pageId && !searchQuery) {
      res.status(400).json({
        detail: "Invalid URL. Must be a Facebook Ads Library URL with view_all_page_id or q= parameter.",
      });
      return;
    }

    const brandScrape = await prisma.brandScrape.create({
      data: { brandName, pageId: pageId || searchQuery!, pageUrl, status: "pending" },
    });

    // Fire-and-forget background scrape, matching the Python route's BackgroundTasks usage.
    scrapeBrand(brandScrape.id).catch((err) => console.error("Background scrape error:", err));

    res.json(brandScrape);
  })
);

router.get(
  "/brand-scrapes",
  asyncHandler(async (_req, res) => {
    res.json(await prisma.brandScrape.findMany({ orderBy: { createdAt: "desc" } }));
  })
);

router.get(
  "/brand-scrapes/:scrapeId",
  asyncHandler(async (req, res) => {
    const scrape = await prisma.brandScrape.findUnique({ where: { id: req.params.scrapeId }, include: { ads: true } });
    if (!scrape) {
      res.status(404).json({ detail: "Brand scrape not found" });
      return;
    }
    res.json(scrape);
  })
);

router.delete(
  "/brand-scrapes/:scrapeId",
  asyncHandler(async (req, res) => {
    const scrape = await prisma.brandScrape.findUnique({ where: { id: req.params.scrapeId } });
    if (!scrape) {
      res.status(404).json({ detail: "Brand scrape not found" });
      return;
    }
    const success = await deleteBrandScrape(scrape.id);
    if (success) {
      res.json({ message: "Brand scrape deleted" });
      return;
    }
    res.status(500).json({ detail: "Failed to delete brand scrape" });
  })
);

export default router;
