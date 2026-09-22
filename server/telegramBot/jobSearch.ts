import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { applications, jobRuns, jobs, searchSettings } from "../../drizzle/schema";
import { getDb } from "../db";
import { importVerifiedListingBatch, type VerifiedListing } from "../verifiedListingImport";
import { ADZUNA_SOURCE_NAME, adzunaJobToVerifiedListing, isAdzunaConfigured, searchAdzunaJobs } from "../jobSearch/adzuna";
import { greenhouseBoardJobToVerifiedListing, searchGreenhouseBoardJobs } from "../jobSearch/greenhouseBoard";
import { INDEED_SOURCE_NAME, indeedJobToVerifiedListing, isApifyConfigured, searchIndeedJobs } from "../jobSearch/indeedApify";
import { findDuplicateGroups, groupByEmployer, pickMostComplete } from "../jobSearch/crossSourceDedup";
import { resolveTargetCities } from "../scoring";
import { ensureSourceEnabled, listGreenhouseWatches } from "./db";

export type JobSearchOutcome =
  | { ok: true; imported: number; shortlisted: number; duplicatesMerged: number }
  | { ok: false; reason: "not_configured" | "no_settings" | "no_results" };

function resultHeader(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as { insertId?: number };
}

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

  // Fetched before claiming so an unconfigured/no-watches user still gets
  // today's early "not_configured" result with no jobRuns row written --
  // unchanged from before this claim-row change. Only once we know something
  // will actually run do we claim the row, but that claim now happens BEFORE
  // any slow external search call, not after all three sources finish (see
  // docs/superpowers/specs/2026-09-12-multi-tenant-stability-design.md,
  // Fix 1 -- this closes the scheduler-overlap race for the career track).
  const watches = await listGreenhouseWatches(userId);
  const willRunAnything = isAdzunaConfigured() || isApifyConfigured() || watches.length > 0;
  if (!willRunAnything) return { ok: false, reason: "not_configured" };

  const claimInsert = await db.insert(jobRuns).values({ userId, status: "running" });
  const claimRunId = resultHeader(claimInsert).insertId;

  // Phase 12: searches every configured city, not just the primary one.
  // Multiplies external calls by cities.length on top of titles.length — for
  // Adzuna (free tier) this is negligible; for Indeed-via-Apify (paid per
  // result, ~$0.05/1,000) it's still fractions of a cent/day at single-user
  // scale, but it does multiply how long a run takes (each source's calls
  // are sequential, unchanged from before) — see ROADMAP.md Phase 12.
  const targetCities = resolveTargetCities(settings);

  try {
    const adzunaListings: VerifiedListing[] = [];
    if (isAdzunaConfigured()) {
      const seen = new Map<string, VerifiedListing>();
      for (const city of targetCities) {
        for (const title of settings.targetTitles) {
          let results;
          try {
            results = await searchAdzunaJobs({ what: title, where: city, distanceKm: settings.radiusKm, resultsPerPage: 10, country: settings.country ?? undefined });
          } catch (error) {
            console.error(`[jobSearch] Adzuna search failed for title "${title}" in "${city}"`, error);
            continue;
          }
          for (const job of results) {
            const listing = adzunaJobToVerifiedListing(job);
            if (listing) seen.set(`${listing.sourceName}:${listing.sourceExternalId}`, listing);
          }
        }
      }
      adzunaListings.push(...Array.from(seen.values()).slice(0, 20));
    }

    const indeedListings: VerifiedListing[] = [];
    if (isApifyConfigured()) {
      const seen = new Map<string, VerifiedListing>();
      for (const city of targetCities) {
        for (const title of settings.targetTitles) {
          let results;
          try {
            results = await searchIndeedJobs({ what: title, where: city, distanceKm: settings.radiusKm });
          } catch (error) {
            console.error(`[jobSearch] Indeed search failed for title "${title}" in "${city}"`, error);
            continue;
          }
          for (const job of results) {
            const listing = indeedJobToVerifiedListing(job);
            if (listing) seen.set(`${listing.sourceName}:${listing.sourceExternalId}`, listing);
          }
        }
      }
      indeedListings.push(...Array.from(seen.values()).slice(0, 20));
    }

    const greenhouseListings: VerifiedListing[] = [];
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
      greenhouseListings.push(
        ...jobs
          .map(job => greenhouseBoardJobToVerifiedListing(job, employer, boardToken))
          .filter((listing): listing is VerifiedListing => listing !== null)
          .slice(0, 30)
      );
    }

    // Cross-source dedup: compare all three sources' candidates before any of
    // them import. A matched group's "most complete" listing is kept in
    // whichever source-list it originally belonged to; the rest are dropped
    // from theirs. See docs/superpowers/specs/2026-09-12-indeed-apify-
    // discovery-design.md for why this runs here, not inside
    // importVerifiedListingBatch (which requires one sourceName per call).
    const allCandidates = [...adzunaListings, ...indeedListings, ...greenhouseListings];
    const duplicateGroups = await findDuplicateGroups(groupByEmployer(allCandidates));
    const toDrop = new Set<VerifiedListing>();
    for (const group of duplicateGroups) {
      const winner = pickMostComplete(group);
      for (const listing of group) {
        if (listing !== winner) toDrop.add(listing);
      }
    }

    const sourceBatches: Array<{ sourceName: string; listings: VerifiedListing[] }> = [
      { sourceName: ADZUNA_SOURCE_NAME, listings: adzunaListings.filter(listing => !toDrop.has(listing)) },
      { sourceName: INDEED_SOURCE_NAME, listings: indeedListings.filter(listing => !toDrop.has(listing)) },
    ];

    let imported = 0;
    let shortlisted = 0;
    let duplicatesMerged = 0;
    let anySourceRan = false;

    for (const batch of sourceBatches) {
      if (batch.listings.length === 0) continue;
      await ensureSourceEnabled(userId, batch.sourceName);
      anySourceRan = true;
      const result = await importVerifiedListingBatch(userId, batch.listings);
      imported += result.imported;
      shortlisted = result.shortlisted; // each batch recomputes the user's full shortlist; the last call's count is authoritative
      duplicatesMerged += result.duplicatesMerged;
    }

    // Greenhouse imports per-watch (each watch's sourceName is unique,
    // "Greenhouse:<token>"), same as before restructuring — just now using the
    // post-dedup filtered list.
    const greenhouseByWatch = new Map<string, VerifiedListing[]>();
    for (const listing of greenhouseListings) {
      if (toDrop.has(listing)) continue;
      const existing = greenhouseByWatch.get(listing.sourceName);
      if (existing) existing.push(listing);
      else greenhouseByWatch.set(listing.sourceName, [listing]);
    }
    for (const listings of Array.from(greenhouseByWatch.values())) {
      if (listings.length === 0) continue;
      anySourceRan = true;
      const result = await importVerifiedListingBatch(userId, listings);
      imported += result.imported;
      shortlisted = result.shortlisted;
      duplicatesMerged += result.duplicatesMerged;
    }

    if (claimRunId) {
      await db
        .update(jobRuns)
        .set({ status: "completed", listingsCollected: imported, shortlistCount: shortlisted, duplicatesMerged, completedAt: new Date() })
        .where(eq(jobRuns.id, claimRunId));
    }

    if (!anySourceRan) return { ok: false, reason: "no_results" };
    return { ok: true, imported, shortlisted, duplicatesMerged };
  } catch (error) {
    if (claimRunId) {
      await db
        .update(jobRuns)
        .set({ status: "failed", errorSummary: error instanceof Error ? error.message : String(error), completedAt: new Date() })
        .where(eq(jobRuns.id, claimRunId));
    }
    throw error;
  }
}

/**
 * Phase 14c: fixed set of common general-labor/entry-level titles searched
 * for the on-request general-work track — deliberately not the user's own
 * targetTitles, and deliberately not run through scoreJob()'s title-match
 * scoring (which would score every one of these low against a candidate's
 * actual career-target titles and misrepresent them as poor fits). This
 * track has no fit score; every result found is presented, capped by count.
 */
export const GENERAL_WORK_TITLES = [
  "Warehouse Associate",
  "Delivery Driver",
  "Retail Associate",
  "Customer Service Representative",
  "General Labourer",
  "Food Service Worker",
];

export const GENERAL_WORK_SOURCE_NAME = "Adzuna:GeneralWork";

const GENERAL_WORK_RESULTS_CAP = 15;

export type GeneralWorkJob = { jobId: number; title: string; employer: string; location: string; originalApplyUrl: string | null };

export type GeneralWorkOutcome =
  | { ok: true; found: number; newJobs: GeneralWorkJob[] }
  | { ok: false; reason: "not_configured" | "no_settings" | "no_results" };

function generalWorkFingerprint(listing: VerifiedListing): string {
  const stableValue = listing.sourceExternalId ?? listing.sourcePostingUrl;
  return `verified-${createHash("sha256").update(`${GENERAL_WORK_SOURCE_NAME}:${stableValue}`).digest("hex")}`;
}

/**
 * Runs the on-request general-work search. Writes directly to the shared
 * `jobs` table (not through importVerifiedListingBatch, which recomputes
 * and overwrites the user's entire daily `shortlistEntries` row across
 * ALL of their scorecards) — deliberately kept out of shortlistEntries
 * entirely, so this track can never mix into or displace the main daily
 * career-track shortlist that runSearchAndNotify/the scheduler read. Each
 * job still needs a `jobs` row so `applications.jobId` can reference it.
 */
export async function runGeneralWorkSearchForUser(userId: number): Promise<GeneralWorkOutcome> {
  if (!isAdzunaConfigured()) return { ok: false, reason: "not_configured" };
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const settings = (await db.select().from(searchSettings).where(eq(searchSettings.userId, userId)).limit(1))[0];
  if (!settings) return { ok: false, reason: "no_settings" };

  await ensureSourceEnabled(userId, GENERAL_WORK_SOURCE_NAME);

  // Claimed before the search loop, not after -- same reasoning as the
  // career-track fix in runJobSearchForUser. See docs/superpowers/specs/
  // 2026-09-12-multi-tenant-stability-design.md, Fix 1.
  const claimInsert = await db.insert(jobRuns).values({ userId, status: "running" });
  const claimRunId = resultHeader(claimInsert).insertId;

  const targetCities = resolveTargetCities(settings);

  try {
    const seen = new Map<string, VerifiedListing>();
    for (const city of targetCities) {
      for (const title of GENERAL_WORK_TITLES) {
        let results;
        try {
          results = await searchAdzunaJobs({ what: title, where: city, distanceKm: settings.radiusKm, resultsPerPage: 5, country: settings.country ?? undefined });
        } catch (error) {
          console.error(`[generalWorkSearch] Adzuna search failed for title "${title}" in "${city}"`, error);
          continue;
        }
        for (const job of results) {
          const listing = adzunaJobToVerifiedListing(job);
          if (listing) seen.set(`${listing.sourceExternalId ?? listing.sourcePostingUrl}`, listing);
        }
      }
    }
    const listings = Array.from(seen.values()).slice(0, GENERAL_WORK_RESULTS_CAP);
    if (listings.length === 0) {
      if (claimRunId) await db.update(jobRuns).set({ status: "completed", completedAt: new Date() }).where(eq(jobRuns.id, claimRunId));
      return { ok: false, reason: "no_results" };
    }

    const jobIds: number[] = [];
    for (const listing of listings) {
      const fingerprint = generalWorkFingerprint(listing);
      await db
        .insert(jobs)
        .values({
          sourceName: GENERAL_WORK_SOURCE_NAME,
          sourcePostingUrl: listing.sourcePostingUrl,
          originalApplyUrl: listing.originalApplyUrl,
          sourceExternalId: listing.sourceExternalId,
          fingerprint,
          title: listing.title,
          employer: listing.employer,
          location: listing.location,
          locationKm: listing.locationKm,
          employmentType: listing.employmentType,
          description: listing.description,
          postedAt: listing.postedAt,
          expiresAt: listing.expiresAt,
          status: "active",
          analysis: { verificationNote: listing.verificationNote, track: "general-work" },
          lastSeenAt: new Date(),
        })
        .onDuplicateKeyUpdate({
          set: { status: "active", lastSeenAt: new Date(), originalApplyUrl: listing.originalApplyUrl },
        });
      const row = (await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.fingerprint, fingerprint)).limit(1))[0];
      if (row) jobIds.push(row.id);
    }
    if (jobIds.length === 0) {
      if (claimRunId) await db.update(jobRuns).set({ status: "completed", completedAt: new Date() }).where(eq(jobRuns.id, claimRunId));
      return { ok: false, reason: "no_results" };
    }

    const existingApplications = await db
      .select({ jobId: applications.jobId, telegramMessageId: applications.telegramMessageId })
      .from(applications)
      .where(and(eq(applications.userId, userId), inArray(applications.jobId, jobIds)));
    // Only a row whose Telegram card actually got delivered counts as "already
    // handled" — see the matching comment in telegramBot/notify.ts.
    const alreadyDecided = new Set(existingApplications.filter(row => row.telegramMessageId).map(row => row.jobId));

    const rows = await db.select().from(jobs).where(inArray(jobs.id, jobIds));
    const newJobs: GeneralWorkJob[] = rows
      .filter(row => !alreadyDecided.has(row.id))
      .map(row => ({ jobId: row.id, title: row.title, employer: row.employer, location: row.location, originalApplyUrl: row.originalApplyUrl }));

    // This track never touches importVerifiedListingBatch (see the function
    // comment above), which is normally what writes `job_runs` -- update the
    // claim row to "completed" instead of inserting a fresh one.
    if (claimRunId) {
      await db
        .update(jobRuns)
        .set({ status: "completed", listingsCollected: listings.length, jobsScored: jobIds.length, shortlistCount: newJobs.length, completedAt: new Date() })
        .where(eq(jobRuns.id, claimRunId));
    }

    return { ok: true, found: listings.length, newJobs };
  } catch (error) {
    if (claimRunId) {
      await db
        .update(jobRuns)
        .set({ status: "failed", errorSummary: error instanceof Error ? error.message : String(error), completedAt: new Date() })
        .where(eq(jobRuns.id, claimRunId));
    }
    throw error;
  }
}
