/**
 * Retrieves real, proven ad copy scraped via the Research module (scraped_ads /
 * brand_scraped_ads) as concrete examples to accompany the distilled-doctrine knowledge
 * base in copyGenerationService — a lightweight "swipe file" layer on top of the
 * principles-only approach: real market-tested copy for this specific product/audience,
 * not just synthesized rules.
 *
 * Uses Postgres full-text search (to_tsvector/plainto_tsquery) rather than embeddings —
 * the corpus is currently tens to low hundreds of rows, well within what lexical search
 * handles well, and this avoids adding a new embedding-API dependency/cost before the
 * corpus is actually large enough to need semantic (not just keyword) matching.
 */
import { prisma } from "../core/prisma";

export interface SwipeExample {
  headline: string | null;
  adCopy: string | null;
  ctaText: string | null;
  source: string | null;
}

interface SwipeRow {
  headline: string | null;
  ad_copy: string | null;
  cta_text: string | null;
  source: string | null;
  rank: number;
}

const DEFAULT_LIMIT = 5;

export function buildSwipeQueryText(
  product: { name?: string; description?: string },
  profile: { pain_points?: string; goals?: string }
): string {
  return [product.name, product.description, profile.pain_points, profile.goals].filter(Boolean).join(" ").trim();
}

/** Runs the same tsquery against both scraped-ad tables and merges by relevance rank.
 * Returns [] on an empty query or a malformed tsquery (e.g. all-stopword input) rather
 * than throwing — this is a "nice to have" enrichment, not a required step in copy
 * generation, so a retrieval miss should never break the actual generation call. */
export async function findRelevantSwipeExamples(queryText: string, limit = DEFAULT_LIMIT): Promise<SwipeExample[]> {
  const trimmed = queryText.trim();
  if (!trimmed) return [];

  try {
    // plainto_tsquery ANDs every word together by default — for a query built from
    // several concatenated fields (product name + description + pain points + goals),
    // requiring every single word to appear in one scraped ad would almost never match
    // anything. Reuse plainto_tsquery purely for its safe tokenization/stemming, then
    // flip its `&` (AND) operators to `|` (OR) so a document matches on ANY overlapping
    // term, with ts_rank still scoring documents that overlap on more terms higher.
    // Critically, filtering must use the `@@` match operator, not just `rank > 0` —
    // ts_rank returns a small nonzero score even for boolean non-matches, which without
    // `@@` let clearly irrelevant rows leak through in testing.
    const rows = await prisma.$queryRaw<SwipeRow[]>`
      WITH query AS (
        SELECT to_tsquery('english', replace(plainto_tsquery('english', ${trimmed})::text, ' & ', ' | ')) AS q
      )
      SELECT headline, ad_copy, cta_text, source, rank FROM (
        SELECT
          headline,
          ad_copy,
          cta_text,
          COALESCE(brand_name, 'competitor') AS source,
          ts_rank(
            to_tsvector('english', coalesce(headline, '') || ' ' || coalesce(ad_copy, '') || ' ' || coalesce(cta_text, '')),
            (SELECT q FROM query)
          ) AS rank
        FROM scraped_ads
        WHERE ad_copy IS NOT NULL AND ad_copy <> ''
          AND to_tsvector('english', coalesce(headline, '') || ' ' || coalesce(ad_copy, '') || ' ' || coalesce(cta_text, '')) @@ (SELECT q FROM query)

        UNION ALL

        SELECT
          headline,
          ad_copy,
          cta_text,
          COALESCE(page_name, 'competitor') AS source,
          ts_rank(
            to_tsvector('english', coalesce(headline, '') || ' ' || coalesce(ad_copy, '') || ' ' || coalesce(cta_text, '')),
            (SELECT q FROM query)
          ) AS rank
        FROM brand_scraped_ads
        WHERE ad_copy IS NOT NULL AND ad_copy <> ''
          AND to_tsvector('english', coalesce(headline, '') || ' ' || coalesce(ad_copy, '') || ' ' || coalesce(cta_text, '')) @@ (SELECT q FROM query)
      ) combined
      ORDER BY rank DESC
      LIMIT ${limit}
    `;

    return rows.map((r) => ({ headline: r.headline, adCopy: r.ad_copy, ctaText: r.cta_text, source: r.source }));
  } catch (err) {
    console.error("Swipe file retrieval failed, continuing without it:", err);
    return [];
  }
}

export function formatSwipeExamplesForPrompt(examples: SwipeExample[]): string {
  if (examples.length === 0) return "";

  const formatted = examples
    .map((ex, i) => {
      const parts = [
        ex.headline ? `Headline: ${ex.headline}` : null,
        ex.adCopy ? `Body: ${ex.adCopy}` : null,
        ex.ctaText ? `CTA: ${ex.ctaText}` : null,
      ].filter(Boolean);
      return `${i + 1}. (from ${ex.source ?? "a competitor"})\n${parts.join("\n")}`;
    })
    .join("\n\n");

  return `PROVEN SWIPE EXAMPLES (real ads scraped from this market — these are evidence of what's currently getting real ad spend/traction in this space, not hypothetical copy):

${formatted}

Use these only as pattern/angle inspiration — what hook shape, structure, or trigger they lean on. Do not copy any line verbatim; adapt the underlying pattern to this brand's voice, product, and offer. If none of them are actually relevant to this product, ignore them.`;
}
