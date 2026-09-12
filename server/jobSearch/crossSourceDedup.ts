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
 * Groups listings by normalized employer name. Listings with no usable
 * employer name (placeholder or blank, see normalizeEmployerName) are
 * excluded entirely — never treated as a dedup candidate group of their own.
 */
export function groupByEmployer(listings: VerifiedListing[]): Map<string, VerifiedListing[]> {
  const groups = new Map<string, VerifiedListing[]>();
  for (const listing of listings) {
    const key = normalizeEmployerName(listing.employer);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) existing.push(listing);
    else groups.set(key, [listing]);
  }
  return groups;
}
