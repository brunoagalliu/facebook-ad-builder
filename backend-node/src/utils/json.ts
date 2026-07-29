/** Strips markdown code fences (```json ... ``` or ``` ... ```) before JSON.parse,
 * since LLMs often wrap JSON responses in them despite being told not to. */
export function extractJsonFromText(text: string): unknown {
  let cleaned = text.trim();
  if (cleaned.includes("```json")) {
    const start = cleaned.indexOf("```json") + 7;
    const end = cleaned.indexOf("```", start);
    cleaned = (end === -1 ? cleaned.slice(start) : cleaned.slice(start, end)).trim();
  } else if (cleaned.includes("```")) {
    const start = cleaned.indexOf("```") + 3;
    const end = cleaned.indexOf("```", start);
    cleaned = (end === -1 ? cleaned.slice(start) : cleaned.slice(start, end)).trim();
  }
  return JSON.parse(cleaned);
}
