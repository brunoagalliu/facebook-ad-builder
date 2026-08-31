/**
 * Promotes scraped ads into WinningAd blueprints — either automatically (the
 * top-performing ads per vertical, by run duration — see researchService.ts's
 * computeRunDurationDays, the "winner" signal for ordinary commercial ads) or
 * manually (a user picking a specific ad they've judged to be a winner, regardless
 * of what the run-duration heuristic says). Both paths funnel through
 * promoteScrapedAd, reusing the existing manual pipeline (templates.ts's /upload
 * creates a bare WinningAd; adRemix.ts's /deconstruct runs Gemini vision on it)
 * rather than duplicating either.
 *
 * Deliberately on-demand only — never wired into the 15-minute research cron — each
 * promotion costs one Gemini vision call, and auto-spending API quota on a timer
 * without the user choosing to isn't a default this app should silently opt into.
 */
import { randomUUID } from "crypto";

import { prisma } from "../core/prisma";
import { deconstructTemplate } from "./adRemixService";
import { extractMediaFromSnapshot, extractTextFromSnapshot } from "./brandScraperService";
import { computeRunDurationDays } from "./researchService";
import { uploadFile } from "./storage";
import { matchVerticalByName } from "./verticalMatchingService";
import { deconstructVideoTemplate } from "./videoBlueprintService";

const DEFAULT_LIMIT = 3;
const DEFAULT_MIN_RUN_DURATION_DAYS = 14;

// WinningAd.imageUrl is required (every existing frontend consumer renders it as an
// <img src>) — video-sourced blueprints that have no separate thumbnail in their ad
// snapshot fall back to this rather than requiring five frontend files to learn to
// handle a null image_url. Same placehold.co fallback pattern imageGenerationService.ts
// already uses when Fal.ai isn't configured.
const VIDEO_PLACEHOLDER_IMAGE_URL = "https://placehold.co/600x400/1f2937/f59e0b/png?text=Video+Ad";

export interface PromotionResult {
  promoted: { winning_ad_id: string; scraped_ad_id: string; headline: string | null; run_duration_days: number | null }[];
  skipped: { scraped_ad_id: string; reason: string }[];
}

async function downloadAndUploadImage(imageUrl: string, scrapedAdId: string): Promise<string> {
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  // Not "winner_" — confirmed live that ad-blocker extensions block requests to that
  // filename pattern (net::ERR_BLOCKED_BY_CLIENT), almost certainly matching "winner"
  // as a common scam/malvertising filter-list keyword.
  const filename = `promoted-ad_${scrapedAdId}_${randomUUID()}.${ext}`;
  return uploadFile(buffer, filename, contentType);
}

async function downloadAndUploadVideo(videoUrl: string, scrapedAdId: string): Promise<string> {
  const response = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Failed to download video: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "video/mp4";
  const filename = `promoted-ad_${scrapedAdId}_${randomUUID()}.mp4`;
  return uploadFile(buffer, filename, contentType);
}

/** Promotes one specific scraped ad into a WinningAd blueprint, regardless of its
 * run-duration score — used both by the manual "mark as winner" action and, in a
 * loop, by the automatic top-N promotion below. Throws (rather than returning a
 * skip reason) so a single manual call gets a real error the caller can surface,
 * while promoteTopAdsForVertical catches per-ad and records it as skipped instead of
 * failing the whole batch. */
export async function promoteScrapedAd(
  scrapedAdId: string,
  source: "auto" | "manual" = "manual"
): Promise<PromotionResult["promoted"][number]> {
  const ad = await prisma.scrapedAd.findUnique({
    where: { id: scrapedAdId },
    include: { winningAd: true, savedSearch: { include: { vertical: true } } },
  });
  if (!ad) throw new Error("Scraped ad not found");
  if (ad.winningAd) throw new Error("This ad has already been promoted to a winning ad");
  if (!ad.adSnapshotUrl) throw new Error("This ad has no snapshot available to extract media from");

  const media = await extractMediaFromSnapshot(ad.adSnapshotUrl);
  const videoSrc = media.videos[0];
  // A genuine second creative version of the ad (Meta's "This ad has multiple
  // versions") — deliberately distinct from media.videoPoster below, which is just a
  // representative frame Facebook generates for the video player, not a real second
  // version worth analyzing on its own.
  const realImageSrc = media.images[0];
  if (!videoSrc && !realImageSrc) throw new Error("No image or video found in ad snapshot");

  const runDurationDays = computeRunDurationDays(ad.startDate, ad.stopDate);
  const label = source === "auto" ? "Auto-promoted" : "Manually marked as a winner";
  const notes =
    runDurationDays !== null ? `${label} from research: running ${runDurationDays} days as of promotion.` : `${label} from research.`;

  // Thumbnail preference: a real distinct creative image first, then the video's own
  // poster frame (a genuine representative shot, not the page's tiny avatar — the
  // original bug), only falling to a generic placeholder if truly nothing visual came
  // back at all.
  const thumbnailSrc = realImageSrc ?? media.videoPoster ?? undefined;
  const uploadedImageUrl = thumbnailSrc ? await downloadAndUploadImage(thumbnailSrc, ad.id) : VIDEO_PLACEHOLDER_IMAGE_URL;

  const winningAd = await prisma.winningAd.create({
    data: {
      name: `${ad.brandName ?? "Unknown"} — ${ad.headline ?? "Untitled"}`.slice(0, 200),
      imageUrl: uploadedImageUrl,
      headline: ad.headline,
      bodyText: ad.adCopy,
      ctaText: ad.ctaText,
      mediaType: videoSrc ? "video" : "image",
      // category is the vertical/niche this ad was scraped under (e.g. "Debt relief")
      // — templateCategory is a different, pre-existing field describing *how* the
      // template was promoted ("Auto-promoted"/"Manually promoted"/"Uploaded"), not
      // what niche it's from. The vertical link (verticalId) already existed on this
      // model but was never surfaced as a readable label anywhere.
      category: ad.savedSearch?.vertical?.name ?? null,
      templateCategory: source === "auto" ? "Auto-promoted" : "Manually promoted",
      productName: ad.brandName,
      notes,
      verticalId: ad.savedSearch?.verticalId ?? null,
      sourceScrapedAdId: ad.id,
      sourceRunDurationDays: runDurationDays,
    },
  });

  // Both blueprint types run independently (not else-if) so an ad with a genuine
  // second image version contributes to both the image- and video-generation blueprint
  // pools instead of one media type silently winning exclusive ownership of the ad.
  try {
    let videoBlueprint: Awaited<ReturnType<typeof deconstructVideoTemplate>> | undefined;
    let imageBlueprint: Awaited<ReturnType<typeof deconstructTemplate>> | undefined;

    if (videoSrc) {
      // Persisted as soon as the upload succeeds, separately from the blueprint update
      // below — a slow or failing Gemini call shouldn't lose a video that's already
      // sitting in R2 (confirmed live: this was happening, leaving video_url null even
      // though the actual file uploaded fine).
      const uploadedVideoUrl = await downloadAndUploadVideo(videoSrc, ad.id);
      await prisma.winningAd.update({ where: { id: winningAd.id }, data: { videoUrl: uploadedVideoUrl } });

      videoBlueprint = await deconstructVideoTemplate(uploadedVideoUrl);
      await prisma.winningAd.update({
        where: { id: winningAd.id },
        data: { videoBlueprintJson: videoBlueprint, blueprintAnalyzedAt: new Date() },
      });
    }
    if (realImageSrc) {
      imageBlueprint = await deconstructTemplate(uploadedImageUrl);
      await prisma.winningAd.update({
        where: { id: winningAd.id },
        data: { blueprintJson: imageBlueprint, blueprintAnalyzedAt: new Date() },
      });
    }

    // Only a fallback: this ScrapedAd already has a real, user-chosen vertical from
    // whichever SavedSearch it came from (set on the WinningAd at create time above)
    // whenever one exists. Detection only fills the gap for searches that were never
    // assigned a vertical — it must never overwrite a real one.
    if (!ad.savedSearch?.verticalId) {
      const detectedCategory = imageBlueprint?.detected_category ?? videoBlueprint?.detected_category ?? null;
      if (detectedCategory) {
        const matched = await matchVerticalByName(detectedCategory);
        await prisma.winningAd.update({
          where: { id: winningAd.id },
          data: { category: detectedCategory, verticalId: matched?.id ?? null },
        });
      }
    }
  } catch (err) {
    // The WinningAd row (with its media) still exists — deconstruction can be
    // retried later, so a Gemini failure here shouldn't roll back the promotion.
    console.error(`Blueprint deconstruction failed for winning ad ${winningAd.id}:`, err);
  }

  return { winning_ad_id: winningAd.id, scraped_ad_id: ad.id, headline: ad.headline, run_duration_days: runDurationDays };
}

/** Promotes a BrandScrapedAd into a WinningAd blueprint — the Brand Scraping feature's
 * equivalent of promoteScrapedAd above. Simpler than that pipeline: brandScraperService
 * already downloads and hosts each ad's media at scrape time (mediaUrls), so there's no
 * ad-snapshot page to re-scrape here — just classify what's already been uploaded and
 * hand stable URLs straight to the blueprint deconstructors. */
export async function promoteBrandScrapedAd(
  brandScrapedAdId: string,
  source: "auto" | "manual" = "manual"
): Promise<PromotionResult["promoted"][number]> {
  const ad = await prisma.brandScrapedAd.findUnique({
    where: { id: brandScrapedAdId },
    include: { winningAd: true, brandScrape: true },
  });
  if (!ad) throw new Error("Scraped ad not found");
  if (ad.winningAd) throw new Error("This ad has already been promoted to a winning ad");

  const mediaUrls = ((ad.mediaUrls as string[] | null) ?? []).filter((url): url is string => typeof url === "string");
  if (mediaUrls.length === 0) throw new Error("This ad has no downloaded media to promote");

  const isVideoUrl = (url: string) => /\.(mp4|webm|mov)(\?|$)/i.test(url);
  const videoUrl = mediaUrls.find(isVideoUrl);
  const imageUrls = mediaUrls.filter((url) => !isVideoUrl(url));
  // For a video ad, the *last* non-video URL is the poster frame Facebook itself
  // generates (confirmed live, inspecting the real DOM, that extraction pushes any
  // background-image/img URLs first and the video's poster last) — earlier entries
  // can be decorative UI assets, not real creative. Image-only ads have no poster
  // concept, so the first URL (extraction order of the real creative images) is fine.
  const realImageUrl = videoUrl ? imageUrls[imageUrls.length - 1] : imageUrls[0];
  if (!videoUrl && !realImageUrl) throw new Error("No usable image or video found for this ad");

  const brandName = ad.brandScrape?.brandName;
  const label = source === "auto" ? "Auto-promoted" : "Manually marked as a winner";
  const notes = `${label} from a brand scrape${brandName ? ` of ${brandName}` : ""}.`;

  const thumbnailUrl = realImageUrl ?? VIDEO_PLACEHOLDER_IMAGE_URL;

  // The bulk list view playwrightScrapeAds reads at scrape time often truncates
  // before the headline/CTA even render (confirmed live: the same ad's card in the
  // bulk grid stopped right after the primary text, while its own snapshot page
  // showed the display URL, headline, and CTA button below the media too). Promoting
  // an ad is a one-off, deliberate action — same cost tradeoff as promoteScrapedAd's
  // extractMediaFromSnapshot call above — so it's worth one extra Playwright page
  // load here to get the complete, correctly-labeled text instead of whatever the
  // bulk scrape happened to capture. Falls back to the bulk-scraped fields if this
  // fails, rather than failing the whole promotion.
  let primaryText = ad.adCopy;
  let headline = ad.headline;
  let ctaText = ad.ctaText;
  if (ad.adLink) {
    try {
      const snapshotText = await extractTextFromSnapshot(ad.adLink);
      if (snapshotText.primaryText) primaryText = snapshotText.primaryText;
      if (snapshotText.headline) headline = snapshotText.headline;
      if (snapshotText.ctaText) ctaText = snapshotText.ctaText;
    } catch (err) {
      console.error(`Failed to fetch full ad text from snapshot for ${ad.id}:`, err);
    }
  }

  const winningAd = await prisma.winningAd.create({
    data: {
      name: `${ad.pageName ?? brandName ?? "Unknown"} — ${headline ?? "Untitled"}`.slice(0, 200),
      imageUrl: thumbnailUrl,
      headline,
      bodyText: primaryText,
      ctaText,
      mediaType: videoUrl ? "video" : "image",
      productName: ad.pageName ?? brandName ?? null,
      notes,
      sourceBrandScrapedAdId: ad.id,
    },
  });

  // Same independent-not-else-if reasoning as promoteScrapedAd above.
  try {
    let videoBlueprint: Awaited<ReturnType<typeof deconstructVideoTemplate>> | undefined;
    let imageBlueprint: Awaited<ReturnType<typeof deconstructTemplate>> | undefined;

    if (videoUrl) {
      await prisma.winningAd.update({ where: { id: winningAd.id }, data: { videoUrl } });
      videoBlueprint = await deconstructVideoTemplate(videoUrl);
      await prisma.winningAd.update({
        where: { id: winningAd.id },
        data: { videoBlueprintJson: videoBlueprint, blueprintAnalyzedAt: new Date() },
      });
    }
    if (realImageUrl) {
      imageBlueprint = await deconstructTemplate(realImageUrl);
      await prisma.winningAd.update({
        where: { id: winningAd.id },
        data: { blueprintJson: imageBlueprint, blueprintAnalyzedAt: new Date() },
      });
    }

    // Brand Scraping has no SavedSearch/Vertical concept at all (unlike
    // promoteScrapedAd above), so this is the only source of a vertical for these
    // ads — not a fallback.
    const detectedCategory = imageBlueprint?.detected_category ?? videoBlueprint?.detected_category ?? null;
    if (detectedCategory) {
      const matched = await matchVerticalByName(detectedCategory);
      await prisma.winningAd.update({
        where: { id: winningAd.id },
        data: { category: detectedCategory, verticalId: matched?.id ?? null },
      });
    }
  } catch (err) {
    console.error(`Blueprint deconstruction failed for winning ad ${winningAd.id}:`, err);
  }

  return { winning_ad_id: winningAd.id, scraped_ad_id: ad.id, headline, run_duration_days: null };
}

export async function promoteTopAdsForVertical(
  verticalId: string,
  options: { limit?: number; minRunDurationDays?: number } = {}
): Promise<PromotionResult> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minRunDurationDays = options.minRunDurationDays ?? DEFAULT_MIN_RUN_DURATION_DAYS;

  const searches = await prisma.savedSearch.findMany({ where: { verticalId } });
  const searchIds = searches.map((s) => s.id);
  const result: PromotionResult = { promoted: [], skipped: [] };
  if (searchIds.length === 0) return result;

  // winningAd: null — no WinningAd already references this ScrapedAd via the unique
  // sourceScrapedAdId FK, so it hasn't been promoted before.
  const candidates = await prisma.scrapedAd.findMany({
    where: { searchId: { in: searchIds }, adSnapshotUrl: { not: null }, winningAd: null },
  });

  const ranked = candidates
    .map((ad) => ({ ad, runDurationDays: computeRunDurationDays(ad.startDate, ad.stopDate) }))
    .filter(
      (c): c is { ad: (typeof candidates)[number]; runDurationDays: number } =>
        c.runDurationDays !== null && c.runDurationDays >= minRunDurationDays
    )
    .sort((a, b) => b.runDurationDays - a.runDurationDays)
    .slice(0, limit);

  for (const { ad } of ranked) {
    try {
      result.promoted.push(await promoteScrapedAd(ad.id, "auto"));
    } catch (err) {
      result.skipped.push({ scraped_ad_id: ad.id, reason: (err as Error).message });
    }
  }

  return result;
}
