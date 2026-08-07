/**
 * AdPlexity Social API (https://app.adplexity.io/docs/api/v2) as an alternative ad
 * source to the Facebook Ads Library API/Playwright scraper in scraperService.ts —
 * structured, paid-per-result data instead of a free but fragile scrape. Returns the
 * same ScrapedAdCreate shape so it drops into researchService's existing dedup/save
 * pipeline unchanged.
 *
 * Pricing (confirmed empirically, not documented in the swagger spec): each call costs
 * 1 base credit + 1 credit per result actually returned — count=1 cost 2 credits,
 * count=50 cost 51. That makes one large request strictly cheaper than several small
 * ones for the same total result count, so pagination below batches in chunks of up to
 * 100 (the API's per-call max) rather than making repeated small calls.
 */
import { prisma } from "../core/prisma";
import { settings } from "../core/config";
import type { ScrapedAdCreate } from "./scraperService";

const BASE_URL = "https://app.adplexity.io/api/v2";
const MAX_COUNT_PER_CALL = 100;
const DATE_RANGE_DAYS = 30; // API's own max window per call

interface AdplexityAd {
  id: number;
  type: number;
  title?: string;
  description?: string;
  image_url?: string;
  video_url?: string;
  landing_pages?: { url?: string }[];
}

interface AdplexitySearchResponse {
  data: AdplexityAd[];
  meta: { credits_cost: number };
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function hostnameFromUrl(url?: string): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

async function logApiUsage(query: string, apiCalls: number, adsReturned: number, adsSaved: number): Promise<void> {
  await prisma.apiUsageLog.create({
    data: {
      endpoint: "adplexity",
      apiCalls,
      adsReturned,
      adsSaved,
      query,
      date: new Date().toISOString().slice(0, 10),
    },
  });
}

function mapAd(ad: AdplexityAd): ScrapedAdCreate {
  // /search/ads doesn't actually return `landing_pages` (only the paid single-ad
  // /ads/{id} lookup does), so this is normally undefined here — kept in case a future
  // response shape or the lookup endpoint populates it. ad_link falls back to the
  // ad's own media asset (confirmed publicly viewable, no auth needed) rather than
  // an AdPlexity API path, which would just 401 without the API key attached.
  const landingUrl = ad.landing_pages?.[0]?.url;
  return {
    brand_name: hostnameFromUrl(landingUrl) ?? "Unknown Brand",
    headline: ad.title ?? null,
    ad_copy: ad.description ? ad.description.slice(0, 500) : null,
    cta_text: null, // AdPlexity's Ad object doesn't expose a separate CTA field
    platform: "facebook",
    external_id: `adplexity_${ad.id}`,
    // AdPlexity returns video_url as "" (not absent) for image ads — `||`, not `??`,
    // so an empty string actually falls through to the next candidate.
    ad_link: landingUrl || ad.video_url || ad.image_url || `https://app.adplexity.io/ads/${ad.id}`,
    platforms: ["facebook"],
    start_date: null, // not exposed per-ad by this endpoint, only as a search filter
    media_type: ad.video_url ? "video" : "image",
  };
}

/** Mirrors searchAds()'s signature/shape from scraperService.ts so callers (and
 * researchService's dedup/save pipeline) can treat both sources interchangeably. */
export async function searchAdplexityAds(
  query: string,
  limit: number,
  _country: string,
  offset: number,
  excludeIds: string[] = [],
  negativeKeywords: string[] = []
): Promise<ScrapedAdCreate[]> {
  if (!settings.ADPLEXITY_API_KEY) {
    throw new Error("ADPLEXITY_API_KEY not configured");
  }

  const pageBlacklist = await prisma.pageBlacklist.findMany();
  const blacklistedPages = new Set(pageBlacklist.map((p) => p.pageName.toLowerCase()));
  const keywordBlacklist = await prisma.keywordBlacklist.findMany();
  const allNegativeKeywords = [...negativeKeywords.map((k) => k.toLowerCase()), ...keywordBlacklist.map((k) => k.keyword.toLowerCase())];

  const endDate = new Date();
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - (DATE_RANGE_DAYS - 1));

  const ads: ScrapedAdCreate[] = [];
  let apiCalls = 0;
  let totalReturned = 0;
  let currentOffset = offset;
  let remaining = limit;

  while (remaining > 0) {
    const count = Math.min(remaining, MAX_COUNT_PER_CALL);
    const params = new URLSearchParams({
      start_date: formatDate(startDate),
      end_date: formatDate(endDate),
      search_query: query,
      search_mode: "keyword.ad_or_lp",
      count: String(count),
      offset: String(currentOffset),
    });

    const response = await fetch(`${BASE_URL}/search/ads?${params.toString()}`, {
      headers: { "X-API-Key": settings.ADPLEXITY_API_KEY, Accept: "application/json" },
    });
    apiCalls++;
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`AdPlexity API error: ${response.status} ${body}`);
    }
    const data = (await response.json()) as AdplexitySearchResponse;
    totalReturned += data.data.length;

    for (const raw of data.data) {
      const externalId = `adplexity_${raw.id}`;
      if (excludeIds.includes(externalId)) continue;

      const mapped = mapAd(raw);
      if (blacklistedPages.size > 0 && mapped.brand_name && blacklistedPages.has(mapped.brand_name.toLowerCase())) {
        continue;
      }
      if (allNegativeKeywords.length > 0) {
        const textToCheck = [mapped.brand_name, mapped.headline, mapped.ad_copy].filter(Boolean).join(" ").toLowerCase();
        if (allNegativeKeywords.some((kw) => textToCheck.includes(kw))) continue;
      }

      ads.push(mapped);
      if (ads.length >= limit) break;
    }

    if (data.data.length < count) break; // fewer results than requested — no more pages
    currentOffset += count;
    remaining -= count;
    if (ads.length >= limit) break;
  }

  await logApiUsage(query, apiCalls, totalReturned, ads.length);
  return ads;
}
