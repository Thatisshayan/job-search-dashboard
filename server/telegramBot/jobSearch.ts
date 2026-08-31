import { eq } from "drizzle-orm";
import { searchSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { importVerifiedListingBatch, type VerifiedListing } from "../verifiedListingImport";
import { ADZUNA_SOURCE_NAME, adzunaJobToVerifiedListing, isAdzunaConfigured, searchAdzunaJobs } from "../jobSearch/adzuna";
import { ensureSourceEnabled } from "./db";

export type JobSearchOutcome =
  | { ok: true; imported: number; shortlisted: number; duplicatesMerged: number }
  | { ok: false; reason: "not_configured" | "no_settings" | "no_results" };

/**
 * Runs one on-demand search for a bot-onboarded user: queries Adzuna for each
 * of their configured target titles, maps + dedupes the results, and imports
 * them through the existing scoring/shortlist pipeline. This is triggered
 * manually today (right after onboarding finishes) — Phase 8 wires the same
 * function into a daily scheduler instead of a one-off call.
 */
export async function runJobSearchForUser(userId: number): Promise<JobSearchOutcome> {
  if (!isAdzunaConfigured()) return { ok: false, reason: "not_configured" };

  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const settings = (await db.select().from(searchSettings).where(eq(searchSettings.userId, userId)).limit(1))[0];
  if (!settings) return { ok: false, reason: "no_settings" };

  await ensureSourceEnabled(userId, ADZUNA_SOURCE_NAME);

  const seen = new Map<string, VerifiedListing>();
  for (const title of settings.targetTitles) {
    let results;
    try {
      results = await searchAdzunaJobs({ what: title, where: settings.city, distanceKm: settings.radiusKm, resultsPerPage: 10 });
    } catch (error) {
      console.error(`[jobSearch] Adzuna search failed for title "${title}"`, error);
      continue;
    }
    for (const job of results) {
      const listing = adzunaJobToVerifiedListing(job);
      if (listing) seen.set(`${listing.sourceName}:${listing.sourceExternalId}`, listing);
    }
  }

  const listings = Array.from(seen.values()).slice(0, 20);
  if (listings.length === 0) return { ok: false, reason: "no_results" };

  const result = await importVerifiedListingBatch(userId, listings);
  return { ok: true, imported: result.imported, shortlisted: result.shortlisted, duplicatesMerged: result.duplicatesMerged };
}
