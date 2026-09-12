import type { VerifiedListing } from "../verifiedListingImport";
import { isApifyConfigured, runApifyActor } from "./apifyClient";

export { isApifyConfigured };

export const INDEED_SOURCE_NAME = "Indeed";

/**
 * Switched from misceres/indeed-scraper (chosen from its public store page
 * only, before a real Apify token was available) to kaix/indeed-scraper
 * after a real live test call confirmed it: 6,170 users vs. a smaller
 * competitor, 99.8%+ success rate, cheaper pay-per-event pricing (from
 * $0.05/1,000 jobs), a real per-job `id` field (misceres' actor had none,
 * forcing a URL fallback), and a genuine direct `apply.url` rather than a
 * tracking redirect. See docs/superpowers/specs/2026-09-12-indeed-apify-
 * discovery-design.md, "Confirmed actor shape" section, for the comparison.
 */
const INDEED_ACTOR_ID = "kaix/indeed-scraper";

const RESULTS_PER_TITLE_CAP = 20;

/**
 * Same single-fixed-country reasoning as Adzuna's ADZUNA_DEFAULT_COUNTRY
 * (server/jobSearch/adzuna.ts) — no per-user country field yet, only a
 * free-text city, so one fixed value covers the whole deployment. Reuses the
 * same env var rather than introducing a second one, since both sources
 * share the same underlying limitation.
 */
const DEFAULT_COUNTRY = (process.env.ADZUNA_DEFAULT_COUNTRY || "ca").toUpperCase();

type IndeedJobRaw = {
  id?: string;
  title?: { text?: string };
  company?: { name?: string };
  location?: { formatted?: string };
  description?: { text?: string };
  apply?: { url?: string };
  urls?: { apply?: string };
  dates?: { posted?: string };
};

/**
 * kaix/indeed-scraper's confirmed real input schema (a live test call was
 * run against it, see design spec): keyword/location/country strings,
 * maxItems caps results (0 means unlimited — never pass 0, this actor bills
 * per result).
 */
export async function searchIndeedJobs(input: { what: string; where: string; distanceKm: number }): Promise<IndeedJobRaw[]> {
  const items = await runApifyActor<IndeedJobRaw>(INDEED_ACTOR_ID, {
    keyword: input.what,
    location: input.where,
    country: DEFAULT_COUNTRY,
    maxItems: RESULTS_PER_TITLE_CAP,
  });
  return items.slice(0, RESULTS_PER_TITLE_CAP);
}

/**
 * Maps a kaix/indeed-scraper result into the shape importVerifiedListingBatch
 * expects. Same conservative-defaults pattern as adzunaJobToVerifiedListing:
 * seniorityMatch defaults to "partial" (no per-job LLM comparison against the
 * résumé at this stage), placeholder text for missing employer/location
 * rather than guessing. This actor has a real per-job `id` (confirmed via a
 * live test call), so sourceExternalId no longer needs a URL fallback.
 */
export function indeedJobToVerifiedListing(job: IndeedJobRaw): VerifiedListing | null {
  const title = job.title?.text;
  const applyUrl = job.apply?.url ?? job.urls?.apply;
  if (!job.id || !title || !applyUrl) return null;

  const description = job.description?.text;
  if (!description || description.trim().length < 80) return null;

  const postedAt = job.dates?.posted ? new Date(job.dates.posted) : new Date();

  return {
    sourceName: INDEED_SOURCE_NAME,
    sourceExternalId: job.id,
    sourcePostingUrl: applyUrl,
    originalApplyUrl: applyUrl,
    title,
    employer: job.company?.name || "Employer not disclosed",
    location: job.location?.formatted || "Location not disclosed",
    employmentType: "full-time",
    description,
    postedAt: Number.isNaN(postedAt.getTime()) ? new Date() : postedAt,
    seniorityMatch: "partial",
    verificationNote: "Retrieved automatically via an Apify Indeed actor (see DECISIONS.md D1's 2026-09-12 update).",
  };
}
