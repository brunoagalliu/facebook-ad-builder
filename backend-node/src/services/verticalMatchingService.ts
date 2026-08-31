/**
 * Matches a Gemini-detected category label (WinningAd.blueprintJson/videoBlueprintJson's
 * detected_category — see adRemixPrompts.ts/videoBlueprintPrompts.ts) against the
 * app's existing, user-curated Vertical taxonomy (Debt relief, Auto insurance, Joint
 * Health, ...), so a promoted ad can be tagged into the same vertical-based
 * auto-selection generation already relies on (blueprintSelectionService.ts).
 *
 * Exact case-insensitive match only — deliberately no fuzzy/substring matching and no
 * auto-creating a new Vertical on a miss. A fuzzy match risks silently misfiling an ad
 * into the wrong vertical (worse than leaving it unmatched); auto-creating verticals
 * from free-text model output risks polluting the taxonomy with near-duplicates
 * ("Debt Relief" vs "debt relief" vs "Debt Relief Program"). Verticals stay something
 * a user explicitly creates via POST /verticals.
 */
import { Vertical } from "@prisma/client";

import { prisma } from "../core/prisma";

export async function matchVerticalByName(rawName: string | null | undefined): Promise<Vertical | null> {
  const trimmed = rawName?.trim();
  if (!trimmed) return null;
  return prisma.vertical.findFirst({ where: { name: { equals: trimmed, mode: "insensitive" } } });
}
