import { invokeLLM } from "../_core/llm";
import type { VerifiedListing } from "../verifiedListingImport";

const LEGAL_SUFFIX_PATTERN = /\b(inc|llc|ltd|corp|co)\b\.?/gi;
const PUNCTUATION_PATTERN = /[.,]/g;

/**
 * Normalizes an employer name for cross-source dedup grouping: lowercase,
 * trimmed, common legal suffixes and punctuation stripped. Placeholder
 * values ("Employer not disclosed", emitted by both Adzuna and Indeed when a
 * company name is missing) normalize to an empty string specifically so
 * groupByEmployer can exclude them — grouping on the placeholder itself
 * would otherwise bucket unrelated jobs from different real employers into
 * one false dedup candidate group.
 */
export function normalizeEmployerName(name: string): string {
  if (name.trim().toLowerCase() === "employer not disclosed") return "";
  return name
    .toLowerCase()
    .replace(PUNCTUATION_PATTERN, "")
    .replace(LEGAL_SUFFIX_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Groups listings by normalized employer name, keeping only groups that
 * contain listings from more than one sourceName — a single-source group
 * can't be a cross-source duplicate, so there's nothing to dedup or compare.
 * Listings with no usable employer name (placeholder or blank, see
 * normalizeEmployerName) are excluded entirely.
 */
export function groupByEmployer(listings: VerifiedListing[]): Map<string, VerifiedListing[]> {
  const allGroups = new Map<string, VerifiedListing[]>();
  for (const listing of listings) {
    const key = normalizeEmployerName(listing.employer);
    if (!key) continue;
    const existing = allGroups.get(key);
    if (existing) existing.push(listing);
    else allGroups.set(key, [listing]);
  }

  const crossSourceGroups = new Map<string, VerifiedListing[]>();
  for (const entry of Array.from(allGroups.entries())) {
    const [key, group] = entry;
    const sources = new Set(group.map(listing => listing.sourceName));
    if (sources.size > 1) crossSourceGroups.set(key, group);
  }
  return crossSourceGroups;
}

const PLACEHOLDER_VALUES = new Set(["Employer not disclosed", "Location not disclosed"]);

function completenessScore(listing: VerifiedListing): number {
  let score = 0;
  if (!PLACEHOLDER_VALUES.has(listing.employer)) score += 1;
  if (!PLACEHOLDER_VALUES.has(listing.location)) score += 1;
  score += listing.description.length;
  if (listing.expiresAt) score += 1;
  return score;
}

/**
 * Picks the single "most complete" listing from a group of cross-source
 * duplicates — whole-listing comparison (fewest placeholder fields, longest
 * description) rather than field-by-field merging. Accepted tradeoff
 * (recorded in the design spec): this can drop a Greenhouse-sourced
 * duplicate — the only source with a tested D2 auto-submit path — in favor
 * of a fuller non-Greenhouse description. Not special-cased here by design.
 */
export function pickMostComplete(group: VerifiedListing[]): VerifiedListing {
  return group.reduce((best, candidate) => (completenessScore(candidate) > completenessScore(best) ? candidate : best));
}

const DUPLICATE_PAIRS_SCHEMA = {
  name: "duplicate_job_pairs",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["duplicatePairs"],
    properties: {
      duplicatePairs: {
        type: "array",
        description: "Pairs of listing IDs (from the candidates list) that describe the same real job posting.",
        items: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 2,
        },
      },
    },
  },
};

function candidateId(listing: VerifiedListing): string {
  return listing.sourceExternalId ?? listing.sourcePostingUrl;
}

/**
 * Union-find over candidateId pairs, so "A=B" and "B=C" collapse into one
 * group {A,B,C} even if the LLM reports them as two separate pairs rather
 * than one triple.
 */
function groupPairs(listings: VerifiedListing[], pairs: [string, string][]): VerifiedListing[][] {
  const byId = new Map(listings.map(listing => [candidateId(listing), listing]));
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (const [a, b] of pairs) {
    if (byId.has(a) && byId.has(b)) union(a, b);
  }

  const grouped = new Map<string, VerifiedListing[]>();
  for (const listing of listings) {
    const id = candidateId(listing);
    if (!parent.has(id)) continue;
    const root = find(id);
    const existing = grouped.get(root);
    if (existing) existing.push(listing);
    else grouped.set(root, [listing]);
  }
  return Array.from(grouped.values()).filter(group => group.length > 1);
}

/**
 * For each employer group with cross-source candidates, one batched LLM call
 * (not one call per pair) asks which candidates describe the same real job
 * posting. Bounds LLM cost to roughly one call per employer-with-overlap,
 * not per pair. A failed call for one group is logged and that group is
 * simply left undeduped (its listings import as-is) — a missed dedup is a
 * minor UX blemish, not worth failing the whole run over.
 */
export async function findDuplicateGroups(employerGroups: Map<string, VerifiedListing[]>): Promise<VerifiedListing[][]> {
  const allGroups: VerifiedListing[][] = [];

  for (const entry of Array.from(employerGroups.entries())) {
    const [employerKey, candidates] = entry;
    const prompt = candidates
      .map(listing => `- id: "${candidateId(listing)}", title: "${listing.title}", description: "${listing.description.slice(0, 500)}"`)
      .join("\n");

    let content: string;
    try {
      const result = await invokeLLM({
        messages: [
          {
            role: "system",
            content:
              "You compare job postings from the same employer across different job boards and identify which ones describe the same real job opening (same role, same team/location — not just the same employer). Return pairs of ids that are the same posting.",
          },
          { role: "user", content: prompt },
        ],
        responseFormat: { type: "json_schema", json_schema: DUPLICATE_PAIRS_SCHEMA },
      });
      const raw = result.choices[0]?.message?.content;
      content = typeof raw === "string" ? raw : "";
      if (!content) throw new Error("empty LLM response");
    } catch (error) {
      console.error(`[crossSourceDedup] duplicate comparison failed for employer group "${employerKey}"`, error);
      continue;
    }

    const parsed = JSON.parse(content) as { duplicatePairs: [string, string][] };
    allGroups.push(...groupPairs(candidates, parsed.duplicatePairs));
  }

  return allGroups;
}
