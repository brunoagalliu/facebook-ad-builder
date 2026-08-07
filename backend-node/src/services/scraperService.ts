/**
 * Ports backend/app/services/scraper.py (FacebookAdsLibraryAPI): official Graph API
 * search first, Playwright DOM-scraping fallback when the API returns nothing or
 * suspiciously few results for a large request.
 */
import { chromium } from "playwright";

import { settings } from "../core/config";
import { prisma } from "../core/prisma";

const GRAPH_BASE_URL = "https://graph.facebook.com/v21.0/ads_archive";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

export interface ScrapedAdCreate {
  brand_name?: string | null;
  headline?: string | null;
  ad_copy?: string | null;
  cta_text?: string | null;
  platform: string;
  external_id?: string | null;
  ad_link: string;
  platforms?: string[] | null;
  start_date?: string | null;
  media_type?: string | null;
  // "Winner" signal fields — see the schema comment on ScrapedAd for why stop_date
  // (run duration) matters more than impressions/spend for ordinary commercial ads.
  stop_date?: string | null;
  impressions_lower?: number | null;
  impressions_upper?: number | null;
  spend_lower?: number | null;
  spend_upper?: number | null;
  currency?: string | null;
}

/** Meta returns impressions/spend as {lower_bound, upper_bound} range objects (string
 * numbers), and only populates them at all for political/issue ads — absent/malformed
 * for the vast majority of ordinary commercial ads this app scrapes. */
function parseRange(value: unknown): { lower: number | null; upper: number | null } {
  if (!value || typeof value !== "object") return { lower: null, upper: null };
  const range = value as { lower_bound?: string; upper_bound?: string };
  const lower = range.lower_bound !== undefined ? Number(range.lower_bound) : null;
  const upper = range.upper_bound !== undefined ? Number(range.upper_bound) : null;
  return {
    lower: lower !== null && Number.isFinite(lower) ? lower : null,
    upper: upper !== null && Number.isFinite(upper) ? upper : null,
  };
}

const accessToken = settings.FACEBOOK_ADS_LIBRARY_TOKEN || settings.FACEBOOK_ACCESS_TOKEN;

async function logApiUsage(query: string, apiCalls: number, adsReturned: number, adsSaved: number): Promise<void> {
  await prisma.apiUsageLog.create({
    data: {
      endpoint: "facebook_ads_library",
      apiCalls,
      adsReturned,
      adsSaved,
      query,
      date: new Date().toISOString().slice(0, 10),
    },
  });
}

function parseApiAd(adData: Record<string, unknown>): ScrapedAdCreate | null {
  const bodies = adData.ad_creative_bodies as string[] | string | undefined;
  const adCopy = Array.isArray(bodies) ? bodies[0] : bodies;

  const titles = adData.ad_creative_link_titles as string[] | string | undefined;
  const headline = Array.isArray(titles) ? titles[0] : titles;

  const captions = adData.ad_creative_link_captions as string[] | string | undefined;
  const ctaText = Array.isArray(captions) ? captions[0] : captions;

  const adId = adData.id as string | undefined;
  const fbLibraryUrl = adId ? `https://www.facebook.com/ads/library/?id=${adId}` : undefined;
  if (!fbLibraryUrl) return null;

  const publisherPlatforms = adData.publisher_platforms as string[] | undefined;
  const platforms = publisherPlatforms?.map((p) => p.toLowerCase()) ?? null;

  const impressions = parseRange(adData.impressions);
  const spend = parseRange(adData.spend);

  return {
    brand_name: (adData.page_name as string) ?? "Unknown Brand",
    headline: headline ?? null,
    ad_copy: adCopy ? adCopy.slice(0, 500) : null,
    cta_text: ctaText ?? null,
    platform: "facebook",
    external_id: adId ?? null,
    ad_link: fbLibraryUrl,
    platforms,
    start_date: (adData.ad_delivery_start_time as string) ?? null,
    stop_date: (adData.ad_delivery_stop_time as string) ?? null,
    media_type: "image",
    impressions_lower: impressions.lower,
    impressions_upper: impressions.upper,
    spend_lower: spend.lower,
    spend_upper: spend.upper,
    currency: (adData.currency as string) ?? null,
  };
}

async function apiSearch(
  query: string,
  limit: number,
  country: string,
  offset: number,
  excludeIds: string[],
  negativeKeywords: string[]
): Promise<ScrapedAdCreate[]> {
  const ads: ScrapedAdCreate[] = [];
  const negativeKeywordsLower = negativeKeywords.map((k) => k.toLowerCase());
  let totalApiCalls = 0;
  let totalAdsReturned = 0;

  const pageBlacklist = await prisma.pageBlacklist.findMany();
  const blacklistedPages = new Set(pageBlacklist.map((p) => p.pageName.toLowerCase()));
  const keywordBlacklist = await prisma.keywordBlacklist.findMany();
  const blacklistedKeywords = keywordBlacklist.map((k) => k.keyword.toLowerCase());

  const allNegativeKeywords = [...negativeKeywordsLower, ...blacklistedKeywords];

  let remaining = limit;
  let afterCursor: string | undefined = offset > 0 ? String(offset) : undefined;

  while (remaining > 0) {
    const batchSize = Math.min(remaining, 300);
    const params = new URLSearchParams({
      access_token: accessToken,
      ad_reached_countries: country,
      search_terms: query,
      ad_active_status: "ACTIVE",
      limit: String(batchSize),
      fields:
        "id,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_snapshot_url,page_name,impressions,spend,currency,publisher_platforms,ad_delivery_start_time,ad_delivery_stop_time",
    });
    if (afterCursor) params.set("after", afterCursor);

    const response = await fetch(`${GRAPH_BASE_URL}?${params.toString()}`);
    totalApiCalls++;
    if (!response.ok) throw new Error(`Graph API error: ${response.status}`);
    const data = (await response.json()) as {
      data?: Record<string, unknown>[];
      paging?: { next?: string; cursors?: { after?: string } };
    };

    if (!data.data || data.data.length === 0) break;

    totalAdsReturned += data.data.length;

    for (const adData of data.data) {
      const adId = adData.id as string;
      if (excludeIds.includes(adId)) continue;

      const parsed = parseApiAd(adData);
      if (!parsed) continue;

      if (blacklistedPages.size > 0 && parsed.brand_name) {
        if (blacklistedPages.has(parsed.brand_name.toLowerCase())) continue;
      }

      if (allNegativeKeywords.length > 0) {
        const textToCheck = [parsed.brand_name, parsed.headline, parsed.ad_copy, parsed.cta_text]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        const matched = allNegativeKeywords.some((kw) => new RegExp(`\\b${escapeRegExp(kw)}\\b`).test(textToCheck));
        if (matched) continue;
      }

      ads.push(parsed);
      if (ads.length >= limit) break;
    }

    if (data.paging?.next) {
      afterCursor = data.paging.cursors?.after;
    } else {
      break;
    }

    remaining -= batchSize;
    if (ads.length >= limit) break;
  }

  await logApiUsage(query, totalApiCalls, totalAdsReturned, ads.length);
  return ads;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function fallbackSearch(
  query: string,
  limit: number,
  country: string,
  offset: number,
  excludeIds: string[],
  negativeKeywords: string[]
): Promise<ScrapedAdCreate[]> {
  const excludeSet = new Set(excludeIds);
  const negativeKeywordsLower = negativeKeywords.map((k) => k.toLowerCase());
  let ads: ScrapedAdCreate[] = [];

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: USER_AGENT });
    const page = await context.newPage();

    const params = new URLSearchParams({
      active_status: "active",
      ad_type: "all",
      country,
      q: query,
      "sort_data[direction]": "desc",
      "sort_data[mode]": "relevancy_monthly_grouped",
      media_type: "all",
    });
    const url = `https://www.facebook.com/ads/library/?${params.toString()}`;

    await page.goto(url, { timeout: 60_000, waitUntil: "domcontentloaded" });
    try {
      await page.waitForSelector("text=Library ID:", { timeout: 15_000 });
    } catch {
      // no ads found — proceed anyway, the evaluate() below will just return []
    }
    await page.waitForTimeout(3000);

    const baseScrolls = Math.min(5, Math.floor(limit / 3) + 1);
    const totalScrolls = baseScrolls + offset * 3;
    for (let i = 0; i < totalScrolls; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(i < baseScrolls ? 1500 : 1000);
    }
    await page.waitForTimeout(2000);

    const adsData = (await page.evaluate(() => {
      const results: Record<string, unknown>[] = [];
      const seenIds = new Set<string>();

      const libraryIdDivs = Array.from(document.querySelectorAll("div")).filter((div) =>
        (div.innerText || "").includes("Library ID:")
      );

      libraryIdDivs.forEach((idDiv) => {
        let current: Element | null = idDiv;
        let adContainer: Element | null = null;

        for (let i = 0; i < 10 && current; i++) {
          const text = (current as HTMLElement).innerText || "";
          if (text.includes("Library ID:") && (text.includes("Sponsored") || text.length > 200)) {
            if (text.length < 15000) adContainer = current;
          }
          current = current.parentElement;
        }
        if (!adContainer) return;

        const text = (adContainer as HTMLElement).innerText || "";
        const idMatch = text.match(/Library ID:\s*(\d+)/);
        if (!idMatch) return;

        const libraryId = idMatch[1];
        if (seenIds.has(libraryId)) return;
        seenIds.add(libraryId);

        const lines = text
          .split(String.fromCharCode(10))
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && l !== String.fromCharCode(8203));

        let brandName = "Unknown Brand";
        let sponsoredIndex = -1;
        for (let i = 0; i < lines.length; i++) {
          if (lines[i] === "Sponsored") {
            sponsoredIndex = i;
            if (i > 0) {
              const candidate = lines[i - 1];
              if (
                candidate &&
                candidate.length > 3 &&
                candidate.length < 150 &&
                !candidate.includes("Library ID") &&
                !candidate.includes("See ad details") &&
                !candidate.includes("Menu") &&
                candidate !== "Active" &&
                candidate !== "Inactive"
              ) {
                brandName = candidate;
              }
            }
            break;
          }
        }

        let adCopy = "";
        let headline = "";
        let captureContent = false;
        for (let i = sponsoredIndex + 1; i < lines.length; i++) {
          const line = lines[i];
          if (
            line.includes("Library ID") ||
            line.includes("Started running") ||
            line.includes("Platforms") ||
            /https?:\/\//i.test(line)
          ) {
            break;
          }
          if (line.length < 3) continue;
          if (!headline && line.length >= 10) {
            headline = line;
            captureContent = true;
            continue;
          }
          if (captureContent && line.length >= 10) {
            adCopy += (adCopy ? "\n" : "") + line;
          }
        }

        let ctaText: string | null = null;
        adContainer.querySelectorAll("a, button").forEach((el) => {
          const elText = ((el as HTMLElement).innerText || "").trim();
          const commonCtas = ["learn more", "shop now", "sign up", "get started", "download", "subscribe", "buy now", "see more"];
          if (commonCtas.some((cta) => elText.toLowerCase().includes(cta))) ctaText = elText;
        });

        const platforms: string[] = [];
        if (text.includes("Facebook")) platforms.push("facebook");
        if (text.includes("Instagram")) platforms.push("instagram");
        if (text.includes("Messenger")) platforms.push("messenger");
        if (text.includes("Audience Network")) platforms.push("audience_network");

        let startDate: string | null = null;
        const dateMatch = text.match(/Started running on\s+([A-Za-z]+\s+\d+,?\s*\d*)/);
        if (dateMatch) startDate = dateMatch[1];

        results.push({
          external_id: libraryId,
          brand_name: brandName,
          headline: headline || null,
          ad_copy: adCopy.substring(0, 500),
          cta_text: ctaText,
          platforms: platforms.length > 0 ? platforms : null,
          start_date: startDate,
        });
      });

      return results;
    })) as Record<string, unknown>[];

    let filteredAdsData = adsData;
    if (excludeSet.size > 0) {
      filteredAdsData = filteredAdsData.filter((ad) => !excludeSet.has(ad.external_id as string));
    }
    if (negativeKeywordsLower.length > 0) {
      filteredAdsData = filteredAdsData.filter((ad) => {
        const textToCheck = [ad.brand_name, ad.headline, ad.ad_copy, ad.cta_text]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return !negativeKeywordsLower.some((kw) => textToCheck.includes(kw));
      });
    }

    ads = filteredAdsData.slice(0, limit).map((adData) => ({
      brand_name: (adData.brand_name as string) ?? "Unknown Brand",
      headline: (adData.headline as string) ?? null,
      ad_copy: ((adData.ad_copy as string) ?? "No copy available").slice(0, 500),
      cta_text: (adData.cta_text as string) ?? null,
      platform: "facebook",
      external_id: adData.external_id as string,
      ad_link: `https://www.facebook.com/ads/library/?id=${adData.external_id}`,
      platforms: (adData.platforms as string[]) ?? null,
      start_date: (adData.start_date as string) ?? null,
    }));
  } finally {
    await browser.close();
  }

  return ads;
}

export async function searchAds(
  query: string,
  limit: number,
  country: string,
  offset: number,
  excludeIds: string[] = [],
  negativeKeywords: string[] = []
): Promise<ScrapedAdCreate[]> {
  if (accessToken) {
    try {
      const ads = await apiSearch(query, limit, country, offset, excludeIds, negativeKeywords);

      let shouldFallback = false;
      if (ads.length === 0) {
        shouldFallback = true;
      } else if (limit >= 100 && ads.length < limit * 0.5) {
        shouldFallback = true;
      }

      if (shouldFallback) {
        return await fallbackSearch(query, limit, country, offset, excludeIds, negativeKeywords);
      }
      return ads;
    } catch (err) {
      console.error("API search failed, falling back to scraper:", err);
    }
  }

  return await fallbackSearch(query, limit, country, offset, excludeIds, negativeKeywords);
}
