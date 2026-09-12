import type { VerifiedListing } from "../verifiedListingImport";
import { isApifyConfigured, runApifyActor } from "./apifyClient";

export { isApifyConfigured };

export const INDEED_SOURCE_NAME = "Indeed";

/**
 * Chosen during implementation research (see docs/superpowers/specs/
 * 2026-09-12-indeed-apify-discovery-design.md, "Confirmed actor shape").
 * Kept as a named constant so swapping actors is a one-line change.
 */
const INDEED_ACTOR_ID = "misceres/indeed-scraper";

const RESULTS_PER_TITLE_CAP = 20;

/**
 * Same single-fixed-country reasoning as Adzuna's ADZUNA_DEFAULT_COUNTRY
 * (server/jobSearch/adzuna.ts) — no per-user country field yet, only a
 * free-text city, so one fixed value covers the whole deployment. Reuses the
 * same env var rather than introducing a second one, since both sources
 * share the same underlying limitation.
 */
const DEFAULT_COUNTRY = process.env.ADZUNA_DEFAULT_COUNTRY || "ca";

type IndeedJobRaw = {
  positionName?: string;
  company?: string;
  location?: string;
  description?: string;
  url?: string;
  postedAt?: string;
};

/**
 * misceres/indeed-scraper's confirmed input schema (see design spec's
 * "Confirmed actor shape" section): position/location/country strings,
 * maxItemsPerSearch caps results (Apify bills per run/result).
 */
export async function searchIndeedJobs(input: { what: string; where: string; distanceKm: number }): Promise<IndeedJobRaw[]> {
  const items = await runApifyActor<IndeedJobRaw>(INDEED_ACTOR_ID, {
    position: input.what,
    location: input.where,
    country: DEFAULT_COUNTRY,
    maxItemsPerSearch: RESULTS_PER_TITLE_CAP,
  });
  return items.slice(0, RESULTS_PER_TITLE_CAP);
}

/**
 * Maps an Apify Indeed actor result into the shape importVerifiedListingBatch
 * expects. Same conservative-defaults pattern as adzunaJobToVerifiedListing:
 * seniorityMatch defaults to "partial" (no per-job LLM comparison against the
 * résumé at this stage), placeholder text for missing employer/location
 * rather than guessing. No documented stable `id` field on this actor's
 * output (see design spec) — `url` doubles as the external id, same as
 * sourcePostingUrl/originalApplyUrl.
 */
export function indeedJobToVerifiedListing(job: IndeedJobRaw): VerifiedListing | null {
  if (!job.positionName || !job.url) return null;
  if (!job.description || job.description.trim().length < 80) return null;

  const postedAt = job.postedAt ? new Date(job.postedAt) : new Date();

  return {
    sourceName: INDEED_SOURCE_NAME,
    sourceExternalId: job.url,
    sourcePostingUrl: job.url,
    originalApplyUrl: job.url,
    title: job.positionName,
    employer: job.company || "Employer not disclosed",
    location: job.location || "Location not disclosed",
    employmentType: "full-time",
    description: job.description,
    postedAt: Number.isNaN(postedAt.getTime()) ? new Date() : postedAt,
    seniorityMatch: "partial",
    verificationNote: "Retrieved automatically via an Apify Indeed actor (see DECISIONS.md D1's 2026-09-12 update).",
  };
}
