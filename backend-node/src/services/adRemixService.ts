/**
 * Ports backend/app/services/ad_remix_service.py, fixing the two known bugs identified
 * during exploration of the Python app rather than reproducing them:
 * 1. deconstruct_template passed the raw image URL string as Gemini's inline_data `data`
 *    field (which needs base64-encoded bytes) — the vision call was never actually
 *    working. This version fetches the image and base64-encodes it first.
 * 2. JSON parsing used plain JSON.parse with no markdown-fence stripping (a helper for
 *    that existed in the Python file but was never called) — this version always goes
 *    through extractJsonFromText.
 */
import { GoogleGenerativeAI } from "@google/generative-ai";
import fs from "fs/promises";
import path from "path";

import { settings } from "../core/config";
import { RECONSTRUCTION_PROMPT_TEMPLATE, DECONSTRUCTION_PROMPT } from "../prompts/adRemixPrompts";
import { AdBlueprint, AdConcept, BrandData, adBlueprintSchema, adConceptSchema } from "../schemas/adBlueprint";
import { extractJsonFromText } from "../utils/json";

// gemini-1.5-flash (the Python original's model) has been deprecated/retired by
// Google, and even gemini-2.5-flash turned out to be blocked for new API keys
// despite still being listed by ListModels — Google is rotating model versions
// faster than this app can track by hardcoding one. Using the "-latest" alias so
// it always resolves to whatever flash-tier model Google currently supports,
// rather than hardcoding a specific version that will eventually get cut off again.
const MODEL = "gemini-flash-latest";
const uploadsDir = path.join(__dirname, "..", "..", "uploads");

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function getClient(): GoogleGenerativeAI {
  if (!settings.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not configured");
  }
  return new GoogleGenerativeAI(settings.GEMINI_API_KEY);
}

async function fetchImageAsBase64(imageUrl: string): Promise<{ mimeType: string; data: string }> {
  const ext = path.extname(imageUrl).toLowerCase();
  const mimeType = MIME_BY_EXT[ext] ?? "image/jpeg";

  // Local uploads (`/uploads/...`) live on this same server's disk — read directly
  // rather than looping back over HTTP.
  if (imageUrl.startsWith("/uploads/")) {
    const filePath = path.join(uploadsDir, imageUrl.slice("/uploads/".length));
    const buffer = await fs.readFile(filePath);
    return { mimeType, data: buffer.toString("base64") };
  }

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch template image: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type");
  return { mimeType: contentType ?? mimeType, data: buffer.toString("base64") };
}

export async function deconstructTemplate(templateImageUrl: string): Promise<AdBlueprint> {
  try {
    const model = getClient().getGenerativeModel({ model: MODEL });
    const { mimeType, data } = await fetchImageAsBase64(templateImageUrl);

    const result = await model.generateContent([DECONSTRUCTION_PROMPT, { inlineData: { mimeType, data } }]);
    const blueprintData = extractJsonFromText(result.response.text());
    return adBlueprintSchema.parse(blueprintData);
  } catch (err) {
    throw new Error(`Failed to deconstruct template: ${(err as Error).message}`);
  }
}

export async function reconstructAd(blueprint: AdBlueprint, brandData: BrandData): Promise<AdConcept> {
  try {
    const model = getClient().getGenerativeModel({ model: MODEL });

    const prompt = RECONSTRUCTION_PROMPT_TEMPLATE({
      blueprintJson: JSON.stringify(blueprint, null, 2),
      brandName: brandData.brand_name,
      brandVoice: brandData.brand_voice || "Professional and friendly",
      productName: brandData.product_name,
      productDescription: brandData.product_description || "",
      audienceDemographics: brandData.audience_demographics || "General audience",
      audiencePainPoints: brandData.audience_pain_points || "Common challenges",
      audienceGoals: brandData.audience_goals || "Desired outcomes",
      campaignOffer: brandData.campaign_offer,
      campaignUrgency: brandData.campaign_urgency || "",
      campaignMessaging: brandData.campaign_messaging,
    });

    const result = await model.generateContent(prompt);
    const conceptData = extractJsonFromText(result.response.text());
    return adConceptSchema.parse(conceptData);
  } catch (err) {
    throw new Error(`Failed to reconstruct ad: ${(err as Error).message}`);
  }
}
