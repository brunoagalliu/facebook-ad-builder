/**
 * Ports backend/app/services/copy_generation_service.py. Applies the curated
 * direct-response doctrine (knowledge/direct_response/*.md) as a system prompt over
 * brand/product/audience/campaign inputs, via the Claude API.
 */
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";

import { settings } from "../core/config";
import { extractJsonFromText } from "../utils/json";

const KNOWLEDGE_DIR = path.join(__dirname, "..", "knowledge", "direct_response");
const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT_TEMPLATE = (knowledgeBase: string): string => `You are the direct-response copywriting engine for an affiliate marketing team's ad creation tool. The following is your doctrine — apply it to every piece of copy you generate, without exception.

${knowledgeBase}

Output ONLY valid JSON or plain text exactly as instructed in the user message — no markdown code fences, no commentary before or after.`;

let cachedKnowledgeBase: string | null = null;

export function getKnowledgeBase(): string {
  if (cachedKnowledgeBase === null) {
    const files = fs
      .readdirSync(KNOWLEDGE_DIR)
      .filter((f) => f.endsWith(".md"))
      .sort();
    cachedKnowledgeBase = files.map((f) => fs.readFileSync(path.join(KNOWLEDGE_DIR, f), "utf-8")).join("\n\n---\n\n");
  }
  return cachedKnowledgeBase;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!settings.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  if (!client) client = new Anthropic({ apiKey: settings.ANTHROPIC_API_KEY });
  return client;
}

function systemPrompt(): string {
  return SYSTEM_PROMPT_TEMPLATE(getKnowledgeBase());
}

interface BrandInput {
  voice?: string;
}
interface ProductInput {
  name?: string;
  description?: string;
}
interface ProfileInput {
  demographics?: string;
  pain_points?: string;
  goals?: string;
}
interface CampaignDetailsInput {
  offer?: string;
  urgency?: string;
  messaging?: string;
}
interface TemplateInput {
  design_style?: string;
}

export function buildVariationsPrompt(
  brand: BrandInput,
  product: ProductInput,
  profile: ProfileInput,
  campaignDetails: CampaignDetailsInput,
  template?: TemplateInput,
  variationCount = 3
): string {
  return `Generate ${variationCount} variations of ad copy for a Facebook/Instagram ad campaign.

BRAND VOICE: ${brand.voice ?? "Professional and friendly"}

PRODUCT: ${product.name ?? ""}
${product.description ? `Description: ${product.description}` : ""}

TARGET AUDIENCE:
- Demographics: ${profile.demographics ?? "General audience"}
- Pain Points: ${profile.pain_points ?? "Not specified"}
- Goals: ${profile.goals ?? "Not specified"}

CAMPAIGN DETAILS:
- Offer: ${campaignDetails.offer ?? ""}
- Urgency: ${campaignDetails.urgency ?? "Not specified"}
- Key Messaging: ${campaignDetails.messaging ?? ""}

TEMPLATE STYLE: ${template?.design_style ?? "Modern and clean"}

Each of the ${variationCount} variations must:
1. Pass the direct-response mandate in your doctrine — a real reason to act now, not just brand messaging
2. Match the brand voice in tone only (voice never overrides the doctrine's urgency/specificity requirements)
3. Draw from a different body-copy framework or trigger combination across variations so they are meaningfully distinct, not restatements of the same angle
4. Address the audience's stated pain points and goals directly
5. Keep headlines under 40 characters
6. Keep body copy under 125 characters for bullet/short styles, up to 200 characters for storytelling styles
7. Keep CTAs under 20 characters, phrased as an instruction, not a soft suggestion

Return ONLY valid JSON in this exact format, no markdown fences, no other text:
{
  "variations": [
    {
      "headline": "Short, punchy headline",
      "body": "Compelling body copy",
      "cta": "Action CTA"
    }
  ]
}`;
}

export function buildFieldPrompt(
  field: string,
  currentValue: string,
  brand: BrandInput,
  product: ProductInput,
  profile: ProfileInput,
  campaignDetails: CampaignDetailsInput
): string {
  const fieldInstructions: Record<string, string> = {
    headline: "Generate a new headline (under 40 characters)",
    body: "Generate new body copy (under 125 characters for bullets, or up to 200 for storytelling)",
    cta: "Generate a new call-to-action (under 20 characters), phrased as an instruction, not a soft suggestion",
  };
  return `${fieldInstructions[field] ?? "Generate new copy"}, applying your direct-response doctrine.

BRAND VOICE: ${brand.voice ?? "Professional and friendly"}
PRODUCT: ${product.name ?? ""}
TARGET AUDIENCE: ${profile.demographics ?? "General audience"}
CAMPAIGN: ${campaignDetails.offer ?? ""}

Current ${field}: ${currentValue}

Generate a DIFFERENT, fresh variation that still passes the direct-response mandate, matches the brand voice, and follows the character limits.

Return ONLY the new ${field} text, nothing else — no quotes, no markdown, no explanation.`;
}

export async function generateVariations(params: {
  brand: BrandInput;
  product: ProductInput;
  profile: ProfileInput;
  campaignDetails: CampaignDetailsInput;
  template?: TemplateInput;
  variationCount?: number;
  customPrompt?: string;
}): Promise<unknown> {
  const prompt =
    params.customPrompt ??
    buildVariationsPrompt(
      params.brand,
      params.product,
      params.profile,
      params.campaignDetails,
      params.template,
      params.variationCount ?? 3
    );

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: systemPrompt(),
    messages: [{ role: "user", content: prompt }],
  });
  const block = response.content[0];
  const text = block.type === "text" ? block.text : "";
  return extractJsonFromText(text);
}

export async function regenerateField(params: {
  field: string;
  currentValue: string;
  brand: BrandInput;
  product: ProductInput;
  profile: ProfileInput;
  campaignDetails: CampaignDetailsInput;
}): Promise<string> {
  const prompt = buildFieldPrompt(
    params.field,
    params.currentValue,
    params.brand,
    params.product,
    params.profile,
    params.campaignDetails
  );
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 300,
    system: systemPrompt(),
    messages: [{ role: "user", content: prompt }],
  });
  const block = response.content[0];
  const text = block.type === "text" ? block.text : "";
  return text.trim().replace(/^["']|["']$/g, "");
}
