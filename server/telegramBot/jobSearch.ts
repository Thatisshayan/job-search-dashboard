import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { applications, jobs, searchSettings } from "../../drizzle/schema";
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

  const seen = new Map<string, VerifiedListing>();
  for (const title of GENERAL_WORK_TITLES) {
    let results;
    try {
      results = await searchAdzunaJobs({ what: title, where: settings.city, distanceKm: settings.radiusKm, resultsPerPage: 5 });
    } catch (error) {
      console.error(`[generalWorkSearch] Adzuna search failed for title "${title}"`, error);
      continue;
    }
    for (const job of results) {
      const listing = adzunaJobToVerifiedListing(job);
      if (listing) seen.set(`${listing.sourceExternalId ?? listing.sourcePostingUrl}`, listing);
    }
  }
  const listings = Array.from(seen.values()).slice(0, GENERAL_WORK_RESULTS_CAP);
  if (listings.length === 0) return { ok: false, reason: "no_results" };

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
  if (jobIds.length === 0) return { ok: false, reason: "no_results" };

  const existingApplications = await db
    .select({ jobId: applications.jobId })
    .from(applications)
    .where(and(eq(applications.userId, userId), inArray(applications.jobId, jobIds)));
  const alreadyDecided = new Set(existingApplications.map(row => row.jobId));

  const rows = await db.select().from(jobs).where(inArray(jobs.id, jobIds));
  const newJobs: GeneralWorkJob[] = rows
    .filter(row => !alreadyDecided.has(row.id))
    .map(row => ({ jobId: row.id, title: row.title, employer: row.employer, location: row.location, originalApplyUrl: row.originalApplyUrl }));

  return { ok: true, found: listings.length, newJobs };
}
