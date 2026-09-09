/**
 * Claude-assisted authoring for video generation prompts, two independent entry
 * points a user can opt into from the VideoAds wizard:
 *   - enhanceSceneAction: expands one rough scene idea into a vivid, filmable beat.
 *     Model-agnostic — the result just becomes the scene's `action` text, which then
 *     flows through whichever prompt-building path (Seedance's buildVideoPrompt or
 *     Kling's per-shot buildKlingShotPrompt) was already going to run.
 *   - reworkPromptWithClaude: polishes the *entire* already-built prompt string for
 *     more natural, specific prose. Deliberately instructed to preserve the
 *     "UGC Authenticity Keywords" and "Universal Quality Control Negatives" lines
 *     verbatim — those are the specific levers this app's own testing already
 *     confirmed keep output from reading as AI-generated, so a rewrite is asked to
 *     polish everything else, not gamble with wording we've already tuned. Only
 *     meaningful for Seedance's single continuous-prompt models: Kling's real content
 *     lives in per-shot multi_prompt entries this never touches (enforced by
 *     videoGenerationRequestSchema's superRefine, not re-checked here).
 */
import Anthropic from "@anthropic-ai/sdk";

import { settings } from "../core/config";
import { CharacterInput } from "../schemas/videoGeneration";

const MODEL = "claude-sonnet-5";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!settings.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY not configured");
  }
  if (!client) client = new Anthropic({ apiKey: settings.ANTHROPIC_API_KEY });
  return client;
}

/** Concatenates all text blocks in the response — content[0] isn't reliably the text
 * block, same lesson already learned in copyGenerationService.ts. */
function extractText(response: { content: Array<{ type: string; text?: string }> }): string {
  return response.content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function buildCharacterContextLine(character?: CharacterInput): string {
  if (!character) return "";
  const bits = [character.name, character.age, character.ethnicity, character.gender].filter(Boolean).join(" ");
  return [bits, character.description].filter(Boolean).join(" — ");
}

export interface EnhanceSceneInput {
  action: string;
  character?: CharacterInput;
  location?: string;
  productName?: string;
  brandVoice?: string;
}

export async function enhanceSceneAction(input: EnhanceSceneInput): Promise<string> {
  const contextLines = [
    buildCharacterContextLine(input.character) ? `Character: ${buildCharacterContextLine(input.character)}` : "",
    input.location ? `Setting: ${input.location}` : "",
    input.productName ? `Product: ${input.productName}` : "",
    input.brandVoice ? `Brand voice: ${input.brandVoice}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `You're writing one beat of action/dialogue for a UGC-style talking-head video ad — the kind a real person would film on their phone. Expand the rough idea below into a vivid, specific, filmable description: what the person does with their hands/body, and exactly what they say in quotes. 1-3 sentences, grounded and natural, not overwritten or melodramatic. Return ONLY the expanded scene text — no preamble, no quotation marks around the whole thing, no explanation.

${contextLines ? `${contextLines}\n\n` : ""}Rough idea: ${input.action}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 300,
    messages: [{ role: "user", content: prompt }],
  });

  const text = extractText(response).trim();
  if (!text) throw new Error("Claude returned no text content");
  return text;
}

export async function reworkPromptWithClaude(basePrompt: string, brandVoice?: string): Promise<string> {
  const prompt = `You are polishing a prompt for an AI video generation model that renders a UGC-style talking-head ad. Rewrite the prose sections to be more vivid, specific, and natural${brandVoice ? `, matching this brand voice: "${brandVoice}"` : ""}.

You MUST NOT remove, shorten, paraphrase, or otherwise alter the "UGC Authenticity Keywords:" line or the "Universal Quality Control Negatives:" line — copy those two lines into your output byte-for-byte exactly as given, wherever they appear. Rewrite everything else freely.

Return ONLY the reworked prompt text — no preamble, no commentary, no markdown fences.

---
${basePrompt}
---`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 1200,
    messages: [{ role: "user", content: prompt }],
  });

  const text = extractText(response).trim();
  if (!text) throw new Error("Claude returned no text content");
  return text;
}
