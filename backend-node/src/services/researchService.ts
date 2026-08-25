/** Ports backend/app/services/research_service.py: content-hash-based dedup,
 * FacebookPage upsert, and per-page total_ads maintenance around a search's results. */
import type { Prisma } from "@prisma/client";
import crypto from "crypto";

import { prisma } from "../core/prisma";
import { searchAdplexityAds } from "./adplexityService";
import { ScrapedAdCreate, searchAds } from "./scraperService";

export interface AdSearchRequestInput {
  query: string;
  source?: "facebook" | "adplexity" | null;
  platform?: string;
  limit: number;
  country: string;
  offset: number;
  exclude_ids: string[];
  negative_keywords: string[];
  vertical_id?: string;
  search_type: string;
  schedule_config?: Record<string, unknown>;
}

function runSearch(request: AdSearchRequestInput): Promise<ScrapedAdCreate[]> {
  const search = request.source === "adplexity" ? searchAdplexityAds : searchAds;
  return search(request.query, request.limit, request.country, request.offset, request.exclude_ids, request.negative_keywords);
}

export function computeContentHash(ad: ScrapedAdCreate): string {
  const content = `${ad.brand_name ?? ""}|${ad.headline ?? ""}|${ad.ad_copy ?? ""}|${ad.cta_text ?? ""}`;
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

/** How many days an ad has been running — the primary "winner" signal available for
 * ordinary commercial ads (Meta only exposes real impressions/spend for political/
 * issue ads). Still-running ads (no stopDate) are measured against now; nobody pays
 * to keep a losing ad live for weeks, so longer-running is a real proxy for "working."
 * Returns null when startDate is missing or unparseable rather than guessing. */
export function computeRunDurationDays(startDate: string | null, stopDate: string | null): number | null {
  if (!startDate) return null;
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime())) return null;

  const end = stopDate ? new Date(stopDate) : new Date();
  if (Number.isNaN(end.getTime())) return null;

  const days = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  return days >= 0 ? days : null;
}

export async function searchAdsWithoutSaving(request: AdSearchRequestInput): Promise<ScrapedAdCreate[]> {
  return runSearch(request);
}

export async function searchAndSave(request: AdSearchRequestInput) {
  const ads = await runSearch(request);

  let adsNew = 0;
  let adsDuplicate = 0;

  const savedSearch = await prisma.savedSearch.create({
    data: {
      query: request.query,
      country: request.country,
      negativeKeywords: request.negative_keywords.length > 0 ? request.negative_keywords : undefined,
      verticalId: request.vertical_id,
      searchType: request.search_type,
      scheduleConfig: request.schedule_config as Prisma.InputJsonValue | undefined,
      isActive: request.search_type !== "one_time",
      adsRequested: request.limit,
      adsReturned: ads.length,
    },
  });

  const savedAds: { id: string; facebookPageId: string | null }[] = [];
  const seenHashes = new Set<string>();

  const allHashes = ads.map(computeContentHash);
  const existingAds = allHashes.length
    ? await prisma.scrapedAd.findMany({ where: { contentHash: { in: allHashes } } })
    : [];
  const existingByHash = new Map(existingAds.map((a) => [a.contentHash, a]));

  for (const adData of ads) {
    const contentHash = computeContentHash(adData);

    if (seenHashes.has(contentHash)) {
      adsDuplicate++;
      continue;
    }
    seenHashes.add(contentHash);

    let existing = existingByHash.get(contentHash);
    if (!existing && adData.external_id) {
      existing = (await prisma.scrapedAd.findUnique({ where: { externalId: adData.external_id } })) ?? undefined;
    }

    if (existing) {
      // Backfill winner-signal fields a prior scrape may have missed (e.g. the API
      // token wasn't configured yet, so the DOM-scraping fallback ran instead and
      // never captured these) — only fill gaps, never overwrite a value already set.
      // Also re-point searchId at the current search: aggregated-ads (Research.jsx)
      // filters ads by `searchId IN (searches for this vertical)`, and searchId was
      // otherwise set once at creation and never touched again — an ad first
      // discovered by a vertical-less or wrong-vertical search stayed permanently
      // invisible in the correct vertical's dashboard even after re-appearing in a
      // properly vertical-scoped search for the same query.
      const updated = await prisma.scrapedAd.update({
        where: { id: existing.id },
        data: {
          searchId: savedSearch.id,
          lastSeen: new Date(),
          seenCount: (existing.seenCount ?? 0) + 1,
          adSnapshotUrl: existing.adSnapshotUrl ?? adData.ad_snapshot_url,
          stopDate: existing.stopDate ?? adData.stop_date,
          impressionsLower: existing.impressionsLower ?? adData.impressions_lower,
          impressionsUpper: existing.impressionsUpper ?? adData.impressions_upper,
          spendLower: existing.spendLower ?? adData.spend_lower,
          spendUpper: existing.spendUpper ?? adData.spend_upper,
          currency: existing.currency ?? adData.currency,
        },
      });
      savedAds.push(updated);
      adsDuplicate++;
    } else {
      adsNew++;
      let fbPageId: string | null = null;
      if (adData.brand_name) {
        let fbPage = await prisma.facebookPage.findUnique({ where: { pageName: adData.brand_name } });
        if (!fbPage) {
          fbPage = await prisma.facebookPage.create({ data: { pageName: adData.brand_name, totalAds: 0 } });
        }
        fbPageId = fbPage.id;
      }

      const created = await prisma.scrapedAd.create({
        data: {
          brandName: adData.brand_name,
          headline: adData.headline,
          adCopy: adData.ad_copy,
          ctaText: adData.cta_text,
          platform: adData.platform,
          externalId: adData.external_id,
          adLink: adData.ad_link,
          platforms: adData.platforms ?? undefined,
          startDate: adData.start_date,
          stopDate: adData.stop_date,
          adSnapshotUrl: adData.ad_snapshot_url,
          mediaType: adData.media_type,
          impressionsLower: adData.impressions_lower,
          impressionsUpper: adData.impressions_upper,
          spendLower: adData.spend_lower,
          spendUpper: adData.spend_upper,
          currency: adData.currency,
          contentHash,
          facebookPageId: fbPageId,
          searchId: savedSearch.id,
        },
      });
      savedAds.push(created);
      existingByHash.set(contentHash, created);
    }
  }

  const pageIds = new Set(savedAds.map((a) => a.facebookPageId).filter((id): id is string => Boolean(id)));
  for (const pageId of pageIds) {
    const total = await prisma.scrapedAd.count({ where: { facebookPageId: pageId } });
    await prisma.facebookPage.update({ where: { id: pageId }, data: { totalAds: total } });
  }

  const updatedSearch = await prisma.savedSearch.update({
    where: { id: savedSearch.id },
    data: { adsNew, adsDuplicate },
  });

  return { savedSearch: updatedSearch, savedAds };
}

export async function getSavedSearches() {
  return prisma.savedSearch.findMany({ orderBy: { createdAt: "desc" }, include: { ads: true } });
}

export async function getSavedSearchWithAds(searchId: string) {
  return prisma.savedSearch.findUnique({ where: { id: searchId }, include: { ads: true } });
}

export async function deleteSavedSearch(searchId: string): Promise<boolean> {
  const existing = await prisma.savedSearch.findUnique({ where: { id: searchId } });
  if (!existing) return false;
  await prisma.savedSearch.delete({ where: { id: searchId } });
  return true;
}
