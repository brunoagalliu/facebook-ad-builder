/**
 * Auto-promotes the best-performing scraped ads (by run duration — see
 * researchService.ts's computeRunDurationDays, the "winner" signal for ordinary
 * commercial ads) into WinningAd blueprints, reusing the existing manual pipeline
 * (templates.ts's /upload creates a bare WinningAd; adRemix.ts's /deconstruct runs
 * Gemini vision on it) rather than duplicating either.
 *
 * Deliberately on-demand only (POST /research/verticals/:id/promote-winners), not
 * wired into the 15-minute research cron — each promotion costs one Gemini vision
 * call, and auto-spending API quota on a timer without the user choosing to isn't
 * a default this app should silently opt into.
 */
import { randomUUID } from "crypto";

import { prisma } from "../core/prisma";
import { deconstructTemplate } from "./adRemixService";
import { extractMediaFromSnapshot } from "./brandScraperService";
import { computeRunDurationDays } from "./researchService";
import { uploadFile } from "./storage";

const DEFAULT_LIMIT = 3;
const DEFAULT_MIN_RUN_DURATION_DAYS = 14;

export interface PromotionResult {
  promoted: { winning_ad_id: string; scraped_ad_id: string; headline: string | null; run_duration_days: number }[];
  skipped: { scraped_ad_id: string; reason: string }[];
}

async function downloadAndUploadImage(imageUrl: string, scrapedAdId: string): Promise<string> {
  const response = await fetch(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Failed to download image: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "image/jpeg";
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  const filename = `winner_${scrapedAdId}_${randomUUID()}.${ext}`;
  return uploadFile(buffer, filename, contentType);
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

  for (const { ad, runDurationDays } of ranked) {
    try {
      const imageUrls = await extractMediaFromSnapshot(ad.adSnapshotUrl!);
      const imageUrl = imageUrls[0];
      if (!imageUrl) {
        result.skipped.push({ scraped_ad_id: ad.id, reason: "No image found in ad snapshot" });
        continue;
      }

      const uploadedUrl = await downloadAndUploadImage(imageUrl, ad.id);

      const winningAd = await prisma.winningAd.create({
        data: {
          name: `${ad.brandName ?? "Unknown"} — ${ad.headline ?? "Untitled"}`.slice(0, 200),
          imageUrl: uploadedUrl,
          templateCategory: "Auto-promoted",
          productName: ad.brandName,
          notes: `Auto-promoted from research: running ${runDurationDays} days as of promotion.`,
          verticalId,
          sourceScrapedAdId: ad.id,
        },
      });

      try {
        const blueprint = await deconstructTemplate(uploadedUrl);
        await prisma.winningAd.update({
          where: { id: winningAd.id },
          data: { blueprintJson: blueprint, blueprintAnalyzedAt: new Date() },
        });
      } catch (err) {
        // The WinningAd row (with its image) still exists — deconstruction can be
        // retried later via the existing POST /ad-remix/deconstruct, so a Gemini
        // failure here shouldn't roll back the promotion itself.
        console.error(`Blueprint deconstruction failed for winning ad ${winningAd.id}:`, err);
      }

      result.promoted.push({
        winning_ad_id: winningAd.id,
        scraped_ad_id: ad.id,
        headline: ad.headline,
        run_duration_days: runDurationDays,
      });
    } catch (err) {
      result.skipped.push({ scraped_ad_id: ad.id, reason: (err as Error).message });
    }
  }

  return result;
}
