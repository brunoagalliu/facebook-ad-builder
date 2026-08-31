/**
 * Auto-picks a WinningAd blueprint for a brand's vertical, so image (and, via its
 * text-level fields, video) generation doesn't require manually browsing templates
 * every time a brand has a vertical assigned (Brand.verticalId).
 *
 * Rotates among the top few candidates rather than always returning the single best
 * one — mirrors copyGenerationService.ts's rotating-knowledge-pool pattern for the
 * same reason: creative variety across generations, not the identical template every
 * time. Ranked by sourceRunDurationDays (auto-promoted blueprints — see
 * winnerPromotionService.ts) first, most-recently-analyzed second (covers manually
 * uploaded/deconstructed blueprints, which have no run-duration score).
 */
import { Prisma } from "@prisma/client";

import { prisma } from "../core/prisma";

const TOP_POOL_SIZE = 5;

/** Shared query behind selectBlueprintForBrand/selectVideoBlueprintForBrand below and
 * blueprintSynthesisService.ts's synthesis functions — the only difference between an
 * "auto-pick one" caller and a "synthesize across all of them" caller is what they do
 * with the returned list, not how candidates are found/ranked. blueprintJson/
 * videoBlueprintJson are never explicitly set to a JSON `null` — unanalyzed rows have
 * a real SQL NULL, so the "not yet deconstructed" filter is Prisma.DbNull, not
 * Prisma.JsonNull (which would instead exclude explicit JSON-null values). */
export async function getCandidateBlueprintsForVertical(verticalId: string, mediaType: "image" | "video", limit: number = TOP_POOL_SIZE) {
  const where: Prisma.WinningAdWhereInput =
    mediaType === "image" ? { verticalId, blueprintJson: { not: Prisma.DbNull } } : { verticalId, videoBlueprintJson: { not: Prisma.DbNull } };

  return prisma.winningAd.findMany({
    where,
    orderBy: [
      { sourceRunDurationDays: { sort: "desc", nulls: "last" } },
      { blueprintAnalyzedAt: { sort: "desc", nulls: "last" } },
    ],
    take: limit,
  });
}

export async function selectBlueprintForBrand(brandId: string) {
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand?.verticalId) return null;

  const candidates = await getCandidateBlueprintsForVertical(brand.verticalId, "image");
  if (candidates.length === 0) return null;

  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** Stage 4 counterpart of selectBlueprintForBrand — same rotating-top-N approach,
 * but over videoBlueprintJson (video-native blueprints, see videoBlueprintService.ts)
 * instead of the image-composition blueprintJson. Used by videoGenerationService.ts,
 * which prefers a real video blueprint when one exists for the brand's vertical
 * rather than only the text-level insight it can pull from an image blueprint. */
export async function selectVideoBlueprintForBrand(brandId: string) {
  const brand = await prisma.brand.findUnique({ where: { id: brandId } });
  if (!brand?.verticalId) return null;

  const candidates = await getCandidateBlueprintsForVertical(brand.verticalId, "video");
  if (candidates.length === 0) return null;

  return candidates[Math.floor(Math.random() * candidates.length)];
}
