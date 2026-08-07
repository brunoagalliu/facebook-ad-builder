/**
 * Ports backend/app/services/brand_scraper.py: scrapes all ads from a specific Facebook
 * page (or search query) and downloads media to R2, via the Graph API where possible and
 * Playwright (with a real Facebook login + network-response interception for media that
 * doesn't have direct downloadable URLs) as a fallback.
 */
import { chromium } from "playwright";

import { settings } from "../core/config";
import { prisma } from "../core/prisma";
import { deleteFromR2, uploadToR2 } from "./storage";

const GRAPH_BASE_URL = "https://graph.facebook.com/v21.0/ads_archive";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const accessToken = settings.FACEBOOK_ADS_LIBRARY_TOKEN || settings.FACEBOOK_ACCESS_TOKEN;

export function parsePageIdFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get("view_all_page_id");
  } catch {
    return null;
  }
}

export function parseSearchQueryFromUrl(url: string): string | null {
  try {
    return new URL(url).searchParams.get("q");
  } catch {
    return null;
  }
}

function sanitizeFolderName(name: string): string {
  const sanitized = name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_");
  return sanitized.toLowerCase().slice(0, 50);
}

interface RawAd {
  id?: string;
  page_id?: string | null;
  page_name?: string | null;
  ad_creative_bodies?: string[] | null;
  ad_creative_link_titles?: string[] | null;
  ad_creative_link_captions?: string[] | null;
  ad_snapshot_url?: string;
  publisher_platforms?: string[];
  ad_delivery_start_time?: string;
  _image_urls?: string[];
  _media_data?: { url: string; type: string; content_type: string; data: Buffer }[];
}

async function fetchPageAds(pageId: string, brandName?: string, limit = 500): Promise<RawAd[]> {
  const isSearchQuery = !/^\d+$/.test(pageId);

  if (isSearchQuery) {
    console.log(`Using Playwright for search query: ${pageId}`);
    return playwrightScrapeAds(pageId, limit, true);
  }

  if (!accessToken) {
    console.log("No FB token, using Playwright for page scrape");
    return playwrightScrapeAds(pageId, limit, false);
  }

  const ads: RawAd[] = [];
  let afterCursor: string | undefined;

  while (ads.length < limit) {
    const params = new URLSearchParams({
      access_token: accessToken,
      ad_active_status: "ALL",
      ad_reached_countries: "US",
      limit: String(Math.min(300, limit - ads.length)),
      fields: "id,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_captions,ad_snapshot_url,page_id,page_name,publisher_platforms,ad_delivery_start_time",
      search_page_ids: pageId,
    });
    if (afterCursor) params.set("after", afterCursor);

    try {
      const response = await fetch(`${GRAPH_BASE_URL}?${params.toString()}`);
      if (!response.ok) throw new Error(`Graph API error: ${response.status}`);
      const data = (await response.json()) as { data?: RawAd[]; paging?: { next?: string; cursors?: { after?: string } } };
      if (!data.data || data.data.length === 0) break;

      ads.push(...data.data);
      console.log(`Fetched ${data.data.length} ads, total: ${ads.length}`);

      if (data.paging?.next) {
        afterCursor = data.paging.cursors?.after;
      } else {
        break;
      }
    } catch (err) {
      console.error("API error, falling back to Playwright:", err);
      return playwrightScrapeAds(pageId, limit, false);
    }
  }

  return ads;
}

/** Facebook-login + network-response-interception Playwright scrape. This is the
 * highest-risk piece of the whole rewrite to actually run: it logs into a real Facebook
 * account via FB_SCRAPER_EMAIL/PASSWORD, which real Facebook can flag as suspicious
 * automation (checkpoints, temporary locks) if run often or from a new environment.
 * Ported faithfully, but treat live invocation with the same caution the Python app's
 * own comments imply — this was never a "safe to hammer" code path. */
async function playwrightScrapeAds(query: string, limit: number, isSearch: boolean): Promise<RawAd[]> {
  const capturedImages = new Map<string, Buffer>();
  const fbEmail = settings.FB_SCRAPER_EMAIL;
  const fbPassword = settings.FB_SCRAPER_PASSWORD;

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, userAgent: USER_AGENT });
    const page = await context.newPage();

    page.on("response", async (response) => {
      const url = response.url();
      const contentType = response.headers()["content-type"] ?? "";
      if (contentType.includes("image") && (url.includes("scontent") || url.includes("fbcdn"))) {
        try {
          const body = await response.body();
          if (body.length > 5000) capturedImages.set(url, body);
        } catch {
          // response body not available (e.g. redirected/aborted) — skip
        }
      }
    });

    if (fbEmail && fbPassword) {
      console.log("Logging into Facebook...");
      await page.goto("https://www.facebook.com/login", { timeout: 30_000 });
      await page.waitForTimeout(2000);
      await page.fill('input[name="email"]', fbEmail);
      await page.fill('input[name="pass"]', fbPassword);
      await page.click('button[name="login"]');
      await page.waitForTimeout(5000);

      const currentUrl = page.url().toLowerCase();
      if (currentUrl.includes("login") || currentUrl.includes("checkpoint")) {
        const errorDetail = currentUrl.includes("login") ? "Login page still showing" : "Security checkpoint triggered";
        throw new Error(`Facebook login failed: ${errorDetail}. URL: ${page.url()}`);
      }
      console.log("Facebook login successful");
    }

    const url = isSearch
      ? `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&media_type=all&q=${encodeURIComponent(query)}`
      : `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=${query}`;

    console.log(`Playwright navigating to: ${url}`);
    await page.goto(url, { timeout: 60_000, waitUntil: "networkidle" });

    try {
      await page.waitForSelector("text=Library ID:", { timeout: 15_000 });
    } catch {
      console.log("No ads found or page didn't load properly");
      return [];
    }

    const scrollCount = Math.min(20, Math.floor(limit / 10));
    for (let i = 0; i < scrollCount; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(1500);
    }

    const ads = (await page.evaluate(() => {
      const results: Record<string, unknown>[] = [];
      const seenIds = new Set<string>();

      document.querySelectorAll("div").forEach((div) => {
        const text = (div as HTMLElement).innerText || "";
        const idMatch = text.match(/Library ID:\s*(\d+)/);
        if (!idMatch) return;

        const libraryId = idMatch[1];
        if (seenIds.has(libraryId)) return;
        seenIds.add(libraryId);

        let pageName: string | null = null;
        const sponsoredIdx = text.indexOf("Sponsored");
        if (sponsoredIdx > 0) {
          const before = text
            .substring(0, sponsoredIdx)
            .split("\n")
            .filter((l) => l.trim());
          if (before.length) pageName = before[before.length - 1].trim();
        }

        let headline: string | null = null;
        let adCopy: string | null = null;
        let ctaText: string | null = null;
        const lines = text
          .split("\n")
          .map((l) => l.trim())
          .filter((l) => l);
        const sponsoredLine = lines.findIndex((l) => l === "Sponsored");
        if (sponsoredLine >= 0) {
          for (let i = sponsoredLine + 1; i < lines.length; i++) {
            if (lines[i].includes("Library ID")) break;
            if (!headline && lines[i].length > 10) headline = lines[i];
            else if (headline && lines[i].length > 10 && !adCopy) adCopy = lines[i];
          }
        }

        const ctaPatterns = ["Learn More", "Shop Now", "Sign Up", "Get Offer", "Book Now", "Download", "Apply Now", "Subscribe"];
        for (const cta of ctaPatterns) {
          if (text.includes(cta)) {
            ctaText = cta;
            break;
          }
        }

        let pageId: string | null = null;
        div.querySelectorAll('a[href*="view_all_page_id"]').forEach((link) => {
          const match = (link as HTMLAnchorElement).href.match(/view_all_page_id=(\d+)/);
          if (match) pageId = match[1];
        });

        const imageUrls: string[] = [];
        div.querySelectorAll('img[src*="scontent"], img[src*="fbcdn"]').forEach((img) => {
          const src = (img as HTMLImageElement).src;
          if (src && !src.includes("emoji") && (img as HTMLImageElement).width > 50 && !imageUrls.includes(src)) {
            imageUrls.push(src);
          }
        });
        div.querySelectorAll('img[data-src*="scontent"], img[data-src*="fbcdn"]').forEach((img) => {
          const dataSrc = (img as HTMLElement).dataset.src;
          if (dataSrc && !imageUrls.includes(dataSrc)) imageUrls.push(dataSrc);
        });
        div.querySelectorAll('[style*="background-image"]').forEach((el) => {
          const match = (el as HTMLElement).style.backgroundImage.match(/url\(["']?(https:[^"')]+)["']?\)/);
          if (match && (match[1].includes("scontent") || match[1].includes("fbcdn")) && !imageUrls.includes(match[1])) {
            imageUrls.push(match[1]);
          }
        });

        results.push({
          id: libraryId,
          page_name: pageName,
          page_id: pageId,
          ad_creative_link_titles: headline ? [headline] : null,
          ad_creative_bodies: adCopy ? [adCopy] : null,
          ad_creative_link_captions: ctaText ? [ctaText] : null,
          _image_urls: imageUrls,
        });
      });

      return results;
    })) as RawAd[];

    console.log(`Playwright extracted ${ads.length} ads, captured ${capturedImages.size} images from network`);

    let matchedCount = 0;
    for (const ad of ads) {
      ad._media_data = [];
      for (const imgUrl of (ad._image_urls ?? []).slice(0, 5)) {
        const data = capturedImages.get(imgUrl);
        if (data) {
          ad._media_data.push({ url: imgUrl, type: "image", content_type: "image/jpeg", data });
          matchedCount++;
        }
      }
    }
    console.log(`Matched ${matchedCount} images to ads`);

    if (matchedCount < ads.length / 2 && capturedImages.size > 0) {
      console.log("Low match rate, distributing captured images to ads");
      const remaining = Array.from(capturedImages.entries());
      let imgIdx = 0;
      for (const ad of ads) {
        if ((ad._media_data?.length ?? 0) === 0 && imgIdx < remaining.length) {
          const [url, data] = remaining[imgIdx];
          ad._media_data!.push({ url, type: "image", content_type: "image/jpeg", data });
          imgIdx++;
        }
      }
    }

    return ads.slice(0, limit);
  } finally {
    await browser.close();
  }
}

/** Plain fetch + regex over an ad-snapshot page's raw HTML — no Playwright, no FB
 * login, so it's cheap to call on-demand (winnerPromotionService.ts uses this to
 * fetch a real image for auto-promoting a scraped ad to a WinningAd blueprint). Hit
 * rate may be lower than the full Playwright scrape below since Facebook's snapshot
 * pages are JS-heavy, but this was already the existing fallback for that same reason
 * when Playwright's network-interception doesn't capture an ad's images. */
export async function extractMediaFromSnapshot(snapshotUrl: string): Promise<string[]> {
  const mediaUrls: string[] = [];
  try {
    const response = await fetch(snapshotUrl, { redirect: "follow" });
    const html = await response.text();

    const imgMatches = html.match(/https:\/\/[^"']+\.(?:jpg|jpeg|png|webp)[^"']*/gi) ?? [];
    mediaUrls.push(...imgMatches.filter((url) => url.includes("scontent")).slice(0, 5));

    const videoMatches = html.match(/https:\/\/[^"']+\.(?:mp4|webm)[^"']*/gi) ?? [];
    mediaUrls.push(...videoMatches.slice(0, 3));
  } catch (err) {
    console.error("Error extracting media from snapshot:", err);
  }
  return mediaUrls;
}

function extensionAndTypeForUrl(mediaUrl: string): { ext: string; mediaType: "video" | "image" } {
  const lower = mediaUrl.toLowerCase();
  if ([".mp4", ".webm", ".mov"].some((e) => lower.includes(e))) return { ext: ".mp4", mediaType: "video" };
  if (lower.includes(".png")) return { ext: ".png", mediaType: "image" };
  if (lower.includes(".webp")) return { ext: ".webp", mediaType: "image" };
  return { ext: ".jpg", mediaType: "image" };
}

async function downloadAndUploadMedia(
  mediaUrl: string,
  folderName: string,
  adId: string,
  index: number
): Promise<{ url: string | null; mediaType: "video" | "image" }> {
  try {
    const { ext, mediaType } = extensionAndTypeForUrl(mediaUrl);
    const response = await fetch(mediaUrl, { redirect: "follow" });
    if (!response.ok) throw new Error(`Failed to download media: ${response.status}`);
    const content = Buffer.from(await response.arrayBuffer());
    if (content.length < 1000) return { url: null, mediaType };

    const filename = `${folderName}/${adId}_${index}${ext}`;
    const url = await uploadToR2(content, filename, mediaType === "video" ? "video/mp4" : "image/jpeg");
    return { url, mediaType };
  } catch (err) {
    console.error("Download/upload error:", err);
    return { url: null, mediaType: "image" };
  }
}

async function processAd(adData: RawAd, brandScrapeId: string, folderName: string): Promise<void> {
  const adId = adData.id;
  if (!adId) return;

  const headline = adData.ad_creative_link_titles?.[0] ?? null;
  const adCopy = adData.ad_creative_bodies?.[0] ?? null;
  const ctaText = adData.ad_creative_link_captions?.[0] ?? null;
  const platforms = adData.publisher_platforms?.map((p) => p.toLowerCase()) ?? null;
  const startDate = adData.ad_delivery_start_time ?? null;

  const r2Urls: string[] = [];
  let originalMediaUrls: string[] = [];
  let mediaType: "image" | "video" | "carousel" = "image";

  if (adData._media_data && adData._media_data.length > 0) {
    for (const [i, mediaItem] of adData._media_data.slice(0, 10).entries()) {
      try {
        originalMediaUrls.push(mediaItem.url);
        const isVideo = mediaItem.content_type.includes("video");
        const ext = isVideo ? ".mp4" : mediaItem.content_type.includes("png") ? ".png" : mediaItem.content_type.includes("webp") ? ".webp" : ".jpg";
        const filename = `${folderName}/${adId}_${i}${ext}`;
        const url = await uploadToR2(mediaItem.data, filename, mediaItem.content_type);
        r2Urls.push(url);
        if (isVideo) mediaType = "video";
      } catch (err) {
        console.error(`Failed to upload media for ad ${adId}:`, err);
      }
    }
  } else {
    let urlList = adData._image_urls ?? [];
    if (urlList.length === 0 && adData.ad_snapshot_url) {
      urlList = await extractMediaFromSnapshot(adData.ad_snapshot_url);
    }
    originalMediaUrls = urlList.slice(0, 10);

    for (const [i, mediaUrl] of originalMediaUrls.entries()) {
      try {
        const { url, mediaType: detected } = await downloadAndUploadMedia(mediaUrl, folderName, adId, i);
        if (url) {
          r2Urls.push(url);
          if (detected === "video") mediaType = "video";
        }
      } catch (err) {
        console.error(`Failed to download media ${mediaUrl}:`, err);
      }
    }
  }

  if (r2Urls.length > 1 && mediaType === "image") mediaType = "carousel";

  const pageName = adData.page_name;
  const pageIdFromAd = adData.page_id;
  const pageLink = pageIdFromAd
    ? `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&view_all_page_id=${pageIdFromAd}`
    : null;

  await prisma.brandScrapedAd.create({
    data: {
      brandScrapeId,
      externalId: adId,
      pageName: pageName?.slice(0, 200),
      pageLink,
      headline: headline?.slice(0, 500),
      adCopy: adCopy?.slice(0, 2000),
      ctaText: ctaText?.slice(0, 200),
      mediaType,
      mediaUrls: r2Urls.length > 0 ? r2Urls : undefined,
      originalMediaUrls: originalMediaUrls.length > 0 ? originalMediaUrls : undefined,
      platforms: platforms ?? undefined,
      startDate,
      adLink: `https://www.facebook.com/ads/library/?id=${adId}`,
    },
  });
}

export async function scrapeBrand(brandScrapeId: string): Promise<void> {
  const brandScrape = await prisma.brandScrape.findUnique({ where: { id: brandScrapeId } });
  if (!brandScrape) return;

  try {
    await prisma.brandScrape.update({ where: { id: brandScrapeId }, data: { status: "scraping" } });

    const adsData = await fetchPageAds(brandScrape.pageId, brandScrape.brandName);

    if (adsData.length === 0) {
      await prisma.brandScrape.update({ where: { id: brandScrapeId }, data: { status: "completed", totalAds: 0 } });
      return;
    }

    const updateData: { pageName?: string; totalAds: number } = { totalAds: adsData.length };
    if (adsData[0]?.page_name) updateData.pageName = adsData[0].page_name!;
    await prisma.brandScrape.update({ where: { id: brandScrapeId }, data: updateData });

    const folderName = sanitizeFolderName(brandScrape.brandName);
    let mediaCount = 0;
    for (const adData of adsData) {
      try {
        await processAd(adData, brandScrapeId, folderName);
        mediaCount += adData._media_data?.length ?? 0;
      } catch (err) {
        console.error(`Error processing ad ${adData.id}:`, err);
      }
    }

    await prisma.brandScrape.update({
      where: { id: brandScrapeId },
      data: { mediaDownloaded: mediaCount, status: "completed" },
    });
  } catch (err) {
    await prisma.brandScrape.update({
      where: { id: brandScrapeId },
      data: { status: "failed", errorMessage: (err as Error).message.slice(0, 500) },
    });
  }
}

export async function deleteBrandScrape(brandScrapeId: string): Promise<boolean> {
  try {
    const brandScrape = await prisma.brandScrape.findUnique({ where: { id: brandScrapeId }, include: { ads: true } });
    if (!brandScrape) return false;

    if (settings.r2Enabled) {
      for (const ad of brandScrape.ads) {
        const urls = (ad.mediaUrls as string[] | null) ?? [];
        for (const url of urls) {
          try {
            await deleteFromR2(url);
          } catch (err) {
            console.error(`Error deleting ${url}:`, err);
          }
        }
      }
    }

    await prisma.brandScrape.delete({ where: { id: brandScrapeId } });
    return true;
  } catch (err) {
    console.error("Error deleting brand scrape:", err);
    return false;
  }
}
