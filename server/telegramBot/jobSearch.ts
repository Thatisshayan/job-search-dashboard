import { eq } from "drizzle-orm";
import { searchSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { importVerifiedListingBatch, type VerifiedListing } from "../verifiedListingImport";
import { ADZUNA_SOURCE_NAME, adzunaJobToVerifiedListing, isAdzunaConfigured, searchAdzunaJobs } from "../jobSearch/adzuna";
import { greenhouseBoardJobToVerifiedListing, searchGreenhouseBoardJobs } from "../jobSearch/greenhouseBoard";
import { ensureSourceEnabled, listGreenhouseWatches } from "./db";

export type JobSearchOutcome =
  | { ok: true; imported: number; shortlisted: number; duplicatesMerged: number }
  | { ok: false; reason: "not_configured" | "no_settings" | "no_results" };

/**
 * Runs one on-demand search for a bot-onboarded user: queries Adzuna for each
 * of their configured target titles (broad discovery), plus every
 * Greenhouse company board the user has registered via /watch (narrow,
 * per-company discovery with real, directly-usable apply URLs — see
 * jobSearch/greenhouseBoard.ts and DECISIONS.md D5's update note for why
 * this exists alongside Adzuna). Imports run through the same scoring/
 * shortlist pipeline either way. Triggered manually right after onboarding
 * and, since Phase 8, once daily by the scheduler.
 */
export async function runJobSearchForUser(userId: number): Promise<JobSearchOutcome> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const settings = (await db.select().from(searchSettings).where(eq(searchSettings.userId, userId)).limit(1))[0];
  if (!settings) return { ok: false, reason: "no_settings" };

  let imported = 0;
  let shortlisted = 0;
  let duplicatesMerged = 0;
  let anySourceRan = false;

  if (isAdzunaConfigured()) {
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
    if (listings.length > 0) {
      anySourceRan = true;
      const result = await importVerifiedListingBatch(userId, listings);
      imported += result.imported;
      shortlisted = result.shortlisted; // each batch recomputes the user's full shortlist; the last call's count is authoritative
      duplicatesMerged += result.duplicatesMerged;
    }
  }

  const watches = await listGreenhouseWatches(userId);
  for (const watch of watches) {
    const boardToken = watch.name.slice("Greenhouse:".length);
    let jobs;
    try {
      jobs = await searchGreenhouseBoardJobs(boardToken);
    } catch (error) {
      console.error(`[jobSearch] Greenhouse board search failed for "${boardToken}"`, error);
      continue;
    }
    const employer = watch.lastStatus?.match(/^Watching (.+)'s Greenhouse board$/)?.[1] ?? boardToken;
    const listings = jobs
      .map(job => greenhouseBoardJobToVerifiedListing(job, employer, boardToken))
      .filter((listing): listing is VerifiedListing => listing !== null)
      .slice(0, 30);
    if (listings.length === 0) continue;
    anySourceRan = true;
    const result = await importVerifiedListingBatch(userId, listings);
    imported += result.imported;
    shortlisted = result.shortlisted;
    duplicatesMerged += result.duplicatesMerged;
  }

  if (!anySourceRan) {
    return isAdzunaConfigured() || watches.length > 0 ? { ok: false, reason: "no_results" } : { ok: false, reason: "not_configured" };
  }

  return { ok: true, imported, shortlisted, duplicatesMerged };
}
