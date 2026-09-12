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
  for (const [key, group] of allGroups) {
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
