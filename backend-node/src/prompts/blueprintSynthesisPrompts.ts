import { AdBlueprint } from "../schemas/adBlueprint";
import { VideoBlueprint } from "../schemas/videoBlueprint";

// "Whole vertical" generation mode's prompt — combines N existing per-ad blueprints
// (adRemixPrompts.ts's DECONSTRUCTION_PROMPT / videoBlueprintPrompts.ts's
// VIDEO_DECONSTRUCTION_PROMPT already produced these, one per promoted winning ad)
// into ONE meta-blueprint representing the patterns that recur across the pool,
// rather than a single random pick. Output shape matches the normal blueprint
// schemas exactly, so the result flows through the existing single-blueprint
// generation code (reconstructAd, buildVideoPrompt, imageGenerationService.ts)
// completely unchanged.
export const IMAGE_SYNTHESIS_PROMPT_TEMPLATE = (blueprints: AdBlueprint[]) => `You are a master creative strategist. Below are ${blueprints.length} structural blueprints, each independently extracted from a different real ad that has proven to be a winner in the same niche/vertical.

Your goal: synthesize these into ONE meta-blueprint that captures the patterns and techniques that recur across multiple examples — not a random pick of one, and not an attempt to describe every example at once. A layout framework, narrative arc, text hierarchy, psychological trigger, or visual style that appears in 2 or more of the examples is a far more trustworthy signal than something only one ad does.

Where the examples genuinely disagree (e.g. one uses a split-screen layout, another a single hero image), pick whichever pattern is most repeated across the set. If there's a real tie, describe the pattern in terms general enough to be reusable rather than inventing an impossible hybrid of both.

BLUEPRINTS:
${blueprints.map((b, i) => `Example ${i + 1}:\n${JSON.stringify(b, null, 2)}`).join("\n\n")}

Return ONLY valid JSON with this exact structure:

{
  "layout_framework": "The most-repeated visual grid/composition pattern across the examples",
  "narrative_arc": "The most-repeated storytelling sequence across the examples",
  "text_hierarchy": "The most-repeated text organization pattern across the examples",
  "psychological_triggers": ["Triggers that appear across multiple examples"],
  "visual_style_guide": "The most-repeated aesthetic vibe across the examples",
  "detected_category": "The shared niche/vertical label across these examples, or null"
}

Do NOT include any other text. Return ONLY the JSON object.`;

export const VIDEO_SYNTHESIS_PROMPT_TEMPLATE = (blueprints: VideoBlueprint[]) => `You are a master creative strategist. Below are ${blueprints.length} structural blueprints, each independently extracted from a different real UGC-style video ad that has proven to be a winner in the same niche/vertical.

Your goal: synthesize these into ONE meta-blueprint that captures the patterns and techniques that recur across multiple examples — not a random pick of one, and not an attempt to describe every example at once. A hook type, narrative arc, pacing style, cinematography choice, or psychological trigger that appears in 2 or more of the examples is a far more trustworthy signal than something only one ad does.

Where the examples genuinely disagree, pick whichever pattern is most repeated across the set. If there's a real tie, describe the pattern in terms general enough to be reusable rather than inventing an impossible hybrid of both.

IMPORTANT — hook_transcript specifically: since this synthesizes multiple ads, do NOT produce a literal verbatim quote (that only makes sense for a single ad) and do NOT fabricate or concatenate quotes from the examples. Instead, describe the common structure/phrasing pattern of the opening line(s) across the examples — e.g. "Opens with a direct question naming the viewer's specific pain point, delivered within the first 2 seconds, in first person."

BLUEPRINTS:
${blueprints.map((b, i) => `Example ${i + 1}:\n${JSON.stringify(b, null, 2)}`).join("\n\n")}

Return ONLY valid JSON with this exact structure:

{
  "hook_transcript": "The common opening-line structure/phrasing pattern across examples (NOT a verbatim quote — see instructions above)",
  "hook_type": "The most-repeated hook type across the examples",
  "narrative_arc": "The most-repeated storytelling sequence across the examples",
  "pacing_and_cuts": "The most-repeated pacing/cutting pattern across the examples",
  "cinematography_style": "The most-repeated camera framing/motion/lighting pattern across the examples",
  "dialogue_style": "The most-repeated tone/pace/energy pattern across the examples",
  "psychological_triggers": ["Triggers that appear across multiple examples"],
  "authenticity_signals": ["UGC authenticity signals that appear across multiple examples"],
  "detected_category": "The shared niche/vertical label across these examples, or null"
}

Do NOT include any other text. Return ONLY the JSON object.`;
