/**
 * Ports backend/app/services/facebook_service.py to the facebook-nodejs-business-sdk.
 *
 * IMPORTANT — the Node SDK is meaningfully different from the Python one used as the
 * source of truth here, not just a syntax port:
 *   - `create*` methods take TWO args, `(fields: string[], params: object)`, not one.
 *   - `FacebookAdsApi.init(accessToken)` only needs the access token (app id/secret
 *     aren't required for direct Marketing API calls with a user token already in hand).
 *   - Image upload has no direct SDK equivalent of Python's `AdImage(...).remote_create()`
 *     against a local file — this calls POST /act_X/adimages with a base64 `bytes` param
 *     directly and parses the `{images: {<key>: {hash}}}` response shape by hand, since
 *     that shape doesn't fit the SDK's generic single-object response handling.
 *   - Video upload uses the SDK's built-in resumable VideoUploader (via `AdVideo`'s
 *     `filepath` + `.create()`), which is a real chunked-upload session, unlike a single
 *     multipart POST.
 * This file has NOT been exercised against a live ad account — verify every write path
 * against a Meta test ad account before ever pointing it at a real one, per the plan.
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

import { settings } from "../core/config";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bizSdk = require("facebook-nodejs-business-sdk");
const { FacebookAdsApi, AdAccount, Campaign, AdSet, AdVideo, User } = bizSdk;

const GRAPH_VERSION = "v21.0";

let api: any = null;
let defaultAccount: any = null;

function ensureAccountId(id: string): string {
  return id.startsWith("act_") ? id : `act_${id}`;
}

export function initialize(): void {
  if (api) return; // idempotent — Python's per-request `FacebookService()` effectively did the same "init if not already" check
  const accessToken = settings.FACEBOOK_ACCESS_TOKEN;
  if (!accessToken) {
    throw new Error("Facebook API Init Error: FACEBOOK_ACCESS_TOKEN not configured");
  }
  try {
    api = FacebookAdsApi.init(accessToken);
    if (settings.FACEBOOK_AD_ACCOUNT_ID) {
      defaultAccount = new AdAccount(ensureAccountId(settings.FACEBOOK_AD_ACCOUNT_ID), {}, undefined, api);
    }
  } catch (err) {
    throw new Error(`Facebook API Init Error: ${(err as Error).message}`);
  }
}

function getApi(): any {
  if (!api) initialize();
  return api;
}

function getAccount(adAccountId?: string): any {
  if (!api) initialize();
  if (adAccountId) {
    return new AdAccount(ensureAccountId(adAccountId), {}, undefined, api);
  }
  if (defaultAccount) return defaultAccount;
  throw new Error("No Ad Account ID provided and no default account set.");
}

function exportAll(cursor: any[]): Record<string, unknown>[] {
  return cursor.map((obj) => (typeof obj.exportData === "function" ? obj.exportData() : obj));
}

export async function getAdAccounts(): Promise<Record<string, unknown>[]> {
  const me = new User("me", {}, undefined, getApi());
  const accounts = await me.getAdAccounts(["id", "name", "account_id", "account_status", "currency", "balance", "amount_spent"]);
  return exportAll(accounts);
}

export async function getCampaigns(adAccountId?: string): Promise<Record<string, unknown>[]> {
  const account = getAccount(adAccountId);
  const fields = ["id", "name", "objective", "status", "daily_budget", "lifetime_budget", "budget_remaining", "bid_strategy", "is_adset_budget_sharing_enabled"];
  const campaigns = await account.getCampaigns(fields, {});
  return exportAll(campaigns);
}

export interface CampaignInput {
  name?: string;
  objective?: string;
  status?: string;
  budget_type?: string;
  budgetType?: string;
  daily_budget?: string | number;
  dailyBudget?: string | number;
  bid_strategy?: string;
  bidStrategy?: string;
}

export async function createCampaign(campaignData: CampaignInput, adAccountId?: string): Promise<Record<string, unknown>> {
  const account = getAccount(adAccountId);

  const params: Record<string, unknown> = {
    name: campaignData.name,
    objective: campaignData.objective,
    status: campaignData.status ?? "PAUSED",
    special_ad_categories: [],
  };

  const budgetType = campaignData.budget_type ?? campaignData.budgetType;
  const dailyBudget = campaignData.daily_budget ?? campaignData.dailyBudget;

  if (budgetType === "CBO" && dailyBudget) {
    params.daily_budget = Math.round(Number(dailyBudget) * 100);
  } else {
    // ABO: Facebook API v24+ requires this flag explicitly for ad-set-level budgets.
    params.is_adset_budget_sharing_enabled = false;
  }

  const bidStrategy = campaignData.bid_strategy ?? campaignData.bidStrategy;
  if (bidStrategy) params.bid_strategy = bidStrategy;

  const result = await account.createCampaign([], params);
  return result.exportData ? result.exportData() : result;
}

export async function getPixels(adAccountId?: string): Promise<Record<string, unknown>[]> {
  const account = getAccount(adAccountId);
  const pixels = await account.getAdsPixels(["id", "name"], {});
  return exportAll(pixels);
}

export async function getPages(): Promise<Record<string, unknown>[]> {
  const me = new User("me", {}, undefined, getApi());
  const pages = await me.getAccounts(["id", "name", "access_token", "category"], {});
  return exportAll(pages);
}

export async function getAdsets(adAccountId?: string, campaignId?: string): Promise<Record<string, unknown>[]> {
  const fields = ["id", "name", "status", "daily_budget", "targeting", "optimization_goal", "billing_event", "bid_amount", "promoted_object", "campaign_id"];
  if (campaignId) {
    const campaign = new Campaign(campaignId, {}, undefined, getApi());
    const adsets = await campaign.getAdSets(fields, {});
    return exportAll(adsets);
  }
  const account = getAccount(adAccountId);
  const adsets = await account.getAdSets(fields, {});
  return exportAll(adsets);
}

export async function getAds(adsetId: string): Promise<Record<string, unknown>[]> {
  const adset = new AdSet(adsetId, {}, undefined, getApi());
  const ads = await adset.getAds(["id", "name", "status", "creative"], {});
  return exportAll(ads);
}

export interface AdSetInput {
  name?: string;
  campaign_id?: string;
  optimization_goal?: string;
  optimizationGoal?: string;
  targeting?: {
    ageMin?: number;
    ageMax?: number;
    genders?: number[];
    geo_locations?: Record<string, unknown>;
    publisher_platforms?: string[];
  };
  advantage_audience?: number;
  pixelId?: string;
  pixel_id?: string;
  conversionEvent?: string;
  conversion_event?: string;
  budget_type?: string;
  budgetType?: string;
  daily_budget?: string | number;
  dailyBudget?: string | number;
  start_time?: string;
  startTime?: string;
  bid_amount?: string | number;
  bidAmount?: string | number;
  bid_strategy?: string;
  bidStrategy?: string;
  status?: string;
}

export async function createAdset(adsetData: AdSetInput, adAccountId?: string): Promise<Record<string, unknown>> {
  const account = getAccount(adAccountId);
  const targeting = adsetData.targeting ?? {};
  const transformedTargeting: Record<string, unknown> = {};

  if (targeting.ageMin !== undefined) transformedTargeting.age_min = targeting.ageMin;
  if (targeting.ageMax !== undefined) transformedTargeting.age_max = targeting.ageMax;
  if (targeting.genders !== undefined) transformedTargeting.genders = targeting.genders;

  if (targeting.geo_locations) {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(targeting.geo_locations)) {
      if (Array.isArray(value)) {
        if (value.length > 0) cleaned[key] = value;
      } else {
        cleaned[key] = value;
      }
    }
    if (Object.keys(cleaned).length > 0) transformedTargeting.geo_locations = cleaned;
  }

  if (targeting.publisher_platforms) transformedTargeting.publisher_platforms = targeting.publisher_platforms;

  // Fix for "Advantage Audience Flag Required" — Facebook requires explicit opt-in/out.
  transformedTargeting.targeting_automation = { advantage_audience: adsetData.advantage_audience ?? 0 };

  const params: Record<string, unknown> = {
    name: adsetData.name,
    campaign_id: adsetData.campaign_id,
    billing_event: "IMPRESSIONS",
    optimization_goal: adsetData.optimization_goal ?? adsetData.optimizationGoal,
    is_dynamic_creative: false,
    status: adsetData.status ?? "PAUSED",
    targeting: transformedTargeting,
  };

  const optimizationGoal = adsetData.optimization_goal ?? adsetData.optimizationGoal;
  if (optimizationGoal === "OFFSITE_CONVERSIONS") {
    const pixelId = adsetData.pixelId ?? adsetData.pixel_id;
    const conversionEvent = adsetData.conversionEvent ?? adsetData.conversion_event;
    if (pixelId && conversionEvent) {
      params.promoted_object = { pixel_id: pixelId, custom_event_type: conversionEvent };
    }
  }

  const budgetType = adsetData.budget_type ?? adsetData.budgetType;
  if (budgetType !== "CBO") {
    const budget = adsetData.daily_budget ?? adsetData.dailyBudget;
    if (budget) params.daily_budget = Math.round(Number(budget) * 100);
  }

  const startTime = adsetData.start_time ?? adsetData.startTime;
  if (startTime) params.start_time = startTime;

  const bidAmount = adsetData.bid_amount ?? adsetData.bidAmount;
  const bidStrategy = adsetData.bid_strategy ?? adsetData.bidStrategy;

  if (bidAmount) {
    params.bid_amount = Math.round(Number(bidAmount) * 100);
    if (bidStrategy) params.bid_strategy = bidStrategy;
  } else if (budgetType !== "CBO") {
    params.bid_strategy = "LOWEST_COST_WITHOUT_CAP";
  }

  const result = await account.createAdSet([], params);
  return result.exportData ? result.exportData() : result;
}

async function fetchBytes(pathOrUrl: string): Promise<{ buffer: Buffer; ext: string }> {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    const response = await fetch(pathOrUrl);
    if (!response.ok) throw new Error(`Failed to download: ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const tail = pathOrUrl.split("/").pop() ?? "";
    const ext = tail.includes(".") ? `.${tail.split(".").pop()!.split("?")[0]}` : ".jpg";
    return { buffer, ext };
  }
  const buffer = await fs.readFile(pathOrUrl);
  return { buffer, ext: path.extname(pathOrUrl) || ".jpg" };
}

/** POSTs directly to /act_X/adimages with a base64 `bytes` param — the Graph API's
 * response shape here (`{images: {<key>: {hash, url}}}`) doesn't fit the SDK's generic
 * single-object response parsing, so this bypasses `account.createAdImage()`. */
export async function uploadImage(imagePathOrUrl: string, adAccountId?: string): Promise<string> {
  const account = getAccount(adAccountId);
  const { buffer } = await fetchBytes(imagePathOrUrl);

  const response = await getApi().call("POST", [account.getId ? account.getId() : account.id, "adimages"], {
    bytes: buffer.toString("base64"),
  });
  const images = (response.images ?? {}) as Record<string, { hash: string }>;
  const first = Object.values(images)[0];
  if (!first?.hash) throw new Error("Facebook did not return an image hash");
  return first.hash;
}

export interface VideoUploadResult {
  video_id: string;
  status: string;
  thumbnails: string[];
}

export async function uploadVideo(
  videoPathOrUrl: string,
  adAccountId: string | undefined,
  waitForReady = true,
  timeoutSeconds = 600
): Promise<VideoUploadResult> {
  const account = getAccount(adAccountId);
  const isUrl = videoPathOrUrl.startsWith("http://") || videoPathOrUrl.startsWith("https://");

  let localPath = videoPathOrUrl;
  if (isUrl) {
    const { buffer, ext } = await fetchBytes(videoPathOrUrl);
    const validExt = [".mp4", ".mov", ".avi", ".webm"].includes(ext) ? ext : ".mp4";
    localPath = path.join(os.tmpdir(), `${randomUUID()}${validExt}`);
    await fs.writeFile(localPath, buffer);
  }

  try {
    const video = new AdVideo(null, { filepath: localPath }, account.getId ? account.getId() : account.id, getApi());
    await video.create();
    const videoId = video.id as string;
    console.log(`Video uploaded with ID: ${videoId}`);

    const status = waitForReady
      ? await waitForVideoReady(videoId, timeoutSeconds)
      : await getVideoStatus(videoId);

    let thumbnails: string[] = [];
    if (status.status === "ready") {
      try {
        thumbnails = await getVideoThumbnails(videoId);
      } catch (err) {
        console.warn("Could not fetch thumbnails:", err);
      }
    }

    return { video_id: videoId, status: status.status || "processing", thumbnails };
  } finally {
    if (isUrl) {
      await fs.unlink(localPath).catch(() => undefined);
    }
  }
}

export async function getVideoStatus(videoId: string): Promise<{ status: string; video_id?: string; length?: number; source?: string; error?: string }> {
  const params = new URLSearchParams({ fields: "id,status,length,source", access_token: settings.FACEBOOK_ACCESS_TOKEN });
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${videoId}?${params.toString()}`);
  const data = (await response.json()) as Record<string, unknown>;

  if (data.error) {
    const error = data.error as { message?: string };
    return { status: "error", error: error.message ?? "Unknown error" };
  }

  const fbStatus = data.status;
  const videoStatus =
    typeof fbStatus === "object" && fbStatus !== null
      ? String((fbStatus as { video_status?: string }).video_status ?? "processing").toLowerCase()
      : String(fbStatus ?? "processing").toLowerCase();

  return { status: videoStatus, video_id: videoId, length: data.length as number | undefined, source: data.source as string | undefined };
}

export async function waitForVideoReady(videoId: string, timeoutSeconds = 600, intervalSeconds = 10) {
  const start = Date.now();
  while (Date.now() - start < timeoutSeconds * 1000) {
    const status = await getVideoStatus(videoId);
    console.log(`Video ${videoId} status: ${status.status}`);
    if (status.status === "ready") return status;
    if (status.status === "error") throw new Error(`Video processing failed: ${status.error ?? "Unknown error"}`);
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1000));
  }
  throw new Error(`Video processing timeout after ${timeoutSeconds} seconds`);
}

export async function getVideoThumbnails(videoId: string): Promise<string[]> {
  const params = new URLSearchParams({ access_token: settings.FACEBOOK_ACCESS_TOKEN });
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${videoId}/thumbnails?${params.toString()}`);
  const data = (await response.json()) as { data?: { uri?: string }[]; error?: { message: string } };
  if (data.error) {
    console.error("Thumbnail fetch error:", data.error);
    return [];
  }
  return (data.data ?? []).map((t) => t.uri).filter((uri): uri is string => Boolean(uri));
}

export interface CreativeInput {
  page_id?: string;
  image_hash?: string;
  video_id?: string;
  primary_text?: string;
  headline?: string;
  cta?: string;
  website_url?: string;
  thumbnail_url?: string;
  description?: string;
  instagram_actor_id?: string;
  name?: string;
}

export async function createCreative(creativeData: CreativeInput, adAccountId?: string): Promise<Record<string, unknown>> {
  const account = getAccount(adAccountId);

  let objectStorySpec: Record<string, unknown>;
  if (creativeData.video_id) {
    const videoData: Record<string, unknown> = {
      video_id: creativeData.video_id,
      message: creativeData.primary_text ?? "",
      title: creativeData.headline ?? "",
      call_to_action: { type: creativeData.cta ?? "LEARN_MORE", value: { link: creativeData.website_url } },
    };
    if (creativeData.thumbnail_url) videoData.image_url = creativeData.thumbnail_url;
    objectStorySpec = { page_id: creativeData.page_id, video_data: videoData };
  } else {
    objectStorySpec = {
      page_id: creativeData.page_id,
      link_data: {
        image_hash: creativeData.image_hash,
        link: creativeData.website_url,
        message: creativeData.primary_text,
        name: creativeData.headline,
        description: creativeData.description,
        call_to_action: { type: creativeData.cta ?? "LEARN_MORE", value: { link: creativeData.website_url } },
      },
    };
  }

  if (creativeData.instagram_actor_id) objectStorySpec.instagram_actor_id = creativeData.instagram_actor_id;

  const result = await account.createAdCreative([], { name: creativeData.name, object_story_spec: objectStorySpec });
  return result.exportData ? result.exportData() : result;
}

export interface AdInput {
  name?: string;
  adset_id?: string;
  creative_id?: string;
  status?: string;
}

export async function createAd(adData: AdInput, adAccountId?: string): Promise<Record<string, unknown>> {
  const account = getAccount(adAccountId);
  const params = {
    name: adData.name,
    adset_id: adData.adset_id,
    creative: { creative_id: adData.creative_id },
    status: adData.status ?? "ACTIVE", // matches Python: ads default to ACTIVE, unlike campaigns/adsets (PAUSED)
  };
  const result = await account.createAd([], params);
  return result.exportData ? result.exportData() : result;
}

export async function searchLocations(
  query: string,
  locationType = "city",
  limit = 10,
  adAccountId?: string
): Promise<Record<string, unknown>[]> {
  const account = getAccount(adAccountId);
  const results = await account.getTargetingSearch([], {
    q: query,
    type: "adgeolocation",
    location_types: [locationType],
    limit,
  });
  return exportAll(results);
}
