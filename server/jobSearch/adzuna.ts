import { ENV } from "../_core/env";
import type { VerifiedListing } from "../verifiedListingImport";

export const ADZUNA_SOURCE_NAME = "Adzuna";

/** See docs/telegram-agent/DECISIONS.md (D1) for why Adzuna, not scraping. */
type AdzunaJob = {
  id: string;
  title: string;
  description: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  contract_time?: "full_time" | "part_time";
  created: string;
  redirect_url: string;
};

type AdzunaSearchResponse = {
  results: AdzunaJob[];
  count: number;
};

export function isAdzunaConfigured() {
  return Boolean(ENV.adzunaAppId && ENV.adzunaAppKey);
}

/**
 * Only "ca"/"us"/"gb" etc. two-letter Adzuna country codes are supported, and
 * this product has no per-user country field yet (only a free-text city) —
 * every search runs against a single fixed country. Revisit once onboarding
 * asks for a country explicitly, or once users outside Canada show up.
 */
const DEFAULT_COUNTRY = process.env.ADZUNA_DEFAULT_COUNTRY || "ca";

export async function searchAdzunaJobs(input: {
  what: string;
  where: string;
  distanceKm: number;
  resultsPerPage?: number;
}): Promise<AdzunaJob[]> {
  if (!isAdzunaConfigured()) {
    throw new Error("ADZUNA_APP_ID/ADZUNA_APP_KEY are not configured");
  }

  const url = new URL(`https://api.adzuna.com/v1/api/jobs/${DEFAULT_COUNTRY}/search/1`);
  url.searchParams.set("app_id", ENV.adzunaAppId);
  url.searchParams.set("app_key", ENV.adzunaAppKey);
  url.searchParams.set("what", input.what);
  url.searchParams.set("where", input.where);
  url.searchParams.set("distance", String(input.distanceKm));
  url.searchParams.set("full_time", "1");
  url.searchParams.set("results_per_page", String(input.resultsPerPage ?? 10));
  url.searchParams.set("content-type", "application/json");

  const response = await fetch(url.toString());
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Adzuna search failed: ${response.status} ${body.slice(0, 300)}`);
  }
  const data = (await response.json()) as AdzunaSearchResponse;
  return data.results ?? [];
}

/**
 * Maps an Adzuna result into the shape importVerifiedListingBatch expects.
 *
 * Two honesty notes, since this product's whole design language elsewhere
 * says "original application link":
 * - `redirect_url` is an Adzuna-hosted redirect, not the employer's own URL.
 *   It does lead to the real application (standard for aggregators), but
 *   it's not literally "the original posting" the way a hand-picked Job Bank
 *   link was in the old manual-import flow.
 * - `seniorityMatch` defaults to "partial" rather than being judged per
 *   listing (no per-job LLM comparison against the resume in this phase) —
 *   deliberately conservative rather than guessing "strong".
 */
export function adzunaJobToVerifiedListing(job: AdzunaJob): VerifiedListing | null {
  if (job.contract_time && job.contract_time !== "full_time") return null;
  if (!job.description || job.description.trim().length < 80) return null;
  if (!job.redirect_url) return null;

  return {
    sourceName: ADZUNA_SOURCE_NAME,
    sourceExternalId: job.id,
    sourcePostingUrl: job.redirect_url,
    originalApplyUrl: job.redirect_url,
    title: job.title,
    employer: job.company?.display_name || "Employer not disclosed",
    location: job.location?.display_name || "Location not disclosed",
    employmentType: "full-time",
    description: job.description,
    postedAt: new Date(job.created),
    seniorityMatch: "partial",
    verificationNote: "Retrieved automatically via the Adzuna job search API (authorized aggregator source, not scraped).",
  };
}
