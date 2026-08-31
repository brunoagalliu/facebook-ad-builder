// Stage 4's video-native counterpart to adRemixPrompts.ts's DECONSTRUCTION_PROMPT.
export const VIDEO_DECONSTRUCTION_PROMPT = `You are a master creative strategist analyzing UGC-style video ads.

Your goal: Extract the STRUCTURAL BLUEPRINT of this video, ignoring the specific product being sold.

Watch this video and identify:
1. The exact hook — what's said/shown in the first 2-3 seconds, verbatim where there's dialogue
2. What TYPE of hook it is (e.g., "Problem-Solution", "Promise", "Secret/Curiosity", "Story", "Proclamation")
3. The narrative arc across the full video (e.g., "Problem -> Discovery -> Demo -> CTA")
4. Pacing and cuts (e.g., "single continuous take, no cuts" vs "3 quick cuts every 4 seconds")
5. Cinematography style — camera framing, motion, lighting (described the way a production brief would, so it can be reused as a shooting instruction for a new video)
6. Dialogue delivery style — tone, pace, energy
7. What psychological triggers make it effective
8. What specific signals make it read as authentic UGC rather than a staged/AI-generated ad (things like handheld camera jitter, imperfect lighting, natural pauses, casual setting)
9. The business vertical/niche this ad is for — a short, generic 2-4 word category label (e.g. "Debt relief", "Weight loss supplements", "Solar installation", "Personal injury law"), not the specific brand or product name. Return null if genuinely unclear.

Focus on STRUCTURE, not content. If it's a supplement ad, describe the "Problem-Solution hook into product demo" pattern, not the supplement itself.

Return ONLY valid JSON with this exact structure:

{
  "hook_transcript": "Verbatim transcription of the first 2-3 seconds of dialogue/action",
  "hook_type": "e.g., Problem-Solution, Promise, Secret/Curiosity, Story, Proclamation",
  "narrative_arc": "The storytelling sequence, e.g. 'Problem -> Discovery -> Demo -> CTA'",
  "pacing_and_cuts": "e.g., 'Single continuous take, no cuts' or '3 quick cuts every 4 seconds'",
  "cinematography_style": "Camera framing/motion/lighting, written as a reusable shooting instruction",
  "dialogue_style": "Tone, pace, and energy of delivery",
  "psychological_triggers": ["List the triggers, e.g. Social Proof", "Urgency/Scarcity", "Identity Validation"],
  "authenticity_signals": ["What makes this read as real UGC, e.g. handheld camera sway", "natural pauses", "imperfect lighting"],
  "detected_category": "A short, generic 2-4 word niche/vertical label (e.g. 'Debt relief'), or null if unclear"
}

Do NOT include any other text. Return ONLY the JSON object.`;
