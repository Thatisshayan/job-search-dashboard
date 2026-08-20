import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { candidateProfiles, jobRuns, jobs, scorecards, searchSettings, shortlistEntries, sourceConfigs } from "../drizzle/schema";
import { getDb, ensureDashboardSetup } from "./db";
import { notifyOwner } from "./_core/notification";
import { scoreJob, type ScoreResult } from "./scoring";

export type VerifiedListing = {
  sourceName: string;
  sourceExternalId?: string;
  sourcePostingUrl: string;
  originalApplyUrl: string;
  title: string;
  employer: string;
  location: string;
  locationKm?: number;
  employmentType: "full-time";
  description: string;
  postedAt: Date;
  expiresAt?: Date;
  seniorityMatch: "strong" | "partial" | "weak";
  verificationNote: string;
};

type ImportedScore = {
  jobId: number;
  score: ScoreResult;
};

const verifiedSkillPatterns: Array<{ skill: string; patterns: RegExp[] }> = [
  { skill: "MS Project", patterns: [/\bms project\b/i] },
  { skill: "multi-site scheduling", patterns: [/\bconstruction schedules?\b/i, /\bschedules? and milestones?\b/i, /\bschedule progress\b/i] },
  { skill: "budget tracking", patterns: [/\bmanage budgets?\b/i, /\bbudget estimates?\b/i] },
  { skill: "drawing review", patterns: [/\bblueprints?\b/i, /\bdrawings?\b/i, /\bCAD\/CADD\b/i] },
  { skill: "scope documentation", patterns: [/\bproject specifications?\b/i] },
  { skill: "subcontractor management", patterns: [/\bsubcontractors?\b/i] },
  { skill: "trade scheduling", patterns: [/\btrade subcontractors?\b/i] },
  { skill: "contract negotiation", patterns: [/\bcontracts?\b/i, /\bcontractual agreements?\b/i] },
  { skill: "quality control", patterns: [/\bquality control\b/i] },
  { skill: "client communication", patterns: [/\bconsult clients?\b/i] },
];

export function getTorontoDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value])) as Record<string, string>;
  return `${values.year}-${values.month}-${values.day}`;
}

export function findVerifiedSkillMatches(description: string) {
  return verifiedSkillPatterns
    .filter(({ patterns }) => patterns.some(pattern => pattern.test(description)))
    .map(({ skill }) => skill);
}

function listingFingerprint(listing: VerifiedListing) {
  const stableValue = listing.sourceExternalId ?? listing.sourcePostingUrl;
  return `verified-${createHash("sha256").update(`${listing.sourceName}:${stableValue}`).digest("hex")}`;
}

function resultHeader(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as { insertId?: number };
}

export async function importVerifiedListings(userId: number, listings: VerifiedListing) {
  return importVerifiedListingBatch(userId, [listings]);
}

export async function importVerifiedListingBatch(userId: number, listings: VerifiedListing[]) {
  if (!listings.length) throw new Error("At least one verified listing is required");
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await ensureDashboardSetup(userId);
  const [profile, settings] = await Promise.all([
    db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId)).limit(1),
    db.select().from(searchSettings).where(eq(searchSettings.userId, userId)).limit(1),
  ]);
  if (!profile[0] || !settings[0]) throw new Error("Candidate profile and search settings are required");

  const runInsert = await db.insert(jobRuns).values({ userId, status: "running", sourcesChecked: 1 });
  const runId = resultHeader(runInsert).insertId;
  if (!runId) throw new Error("Unable to create a job-run record");

  try {
    const source = (await db.select().from(sourceConfigs).where(and(eq(sourceConfigs.userId, userId), eq(sourceConfigs.name, listings[0].sourceName))).limit(1))[0];
    if (!source) throw new Error(`Source configuration not found: ${listings[0].sourceName}`);
    if (!source.enabled) throw new Error(`Source is disabled: ${listings[0].sourceName}`);
    if (listings.some(listing => listing.sourceName !== source.name)) throw new Error("Each import batch must use one configured source");

    let duplicatesMerged = 0;
    const newJobIds = new Set<number>();
    const importedScores: ImportedScore[] = [];
    for (const listing of listings) {
      const fingerprint = listingFingerprint(listing);
      const existing = (await db.select().from(jobs).where(eq(jobs.fingerprint, fingerprint)).limit(1))[0];
      if (existing) duplicatesMerged += 1;
      const skillMatches = findVerifiedSkillMatches(listing.description);
      const score = scoreJob({
        title: listing.title,
        description: listing.description,
        employmentType: listing.employmentType,
        location: listing.location,
        locationKm: listing.locationKm,
        originalApplyUrl: listing.originalApplyUrl,
        postedAt: listing.postedAt,
        expiresAt: listing.expiresAt,
        status: "active",
        skillMatches,
        seniorityMatch: listing.seniorityMatch,
      });
      await db.insert(jobs).values({
        sourceConfigId: source.id,
        sourceName: listing.sourceName,
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
        analysis: { verificationNote: listing.verificationNote, skillMatches, seniorityMatch: listing.seniorityMatch },
        lastSeenAt: new Date(),
      }).onDuplicateKeyUpdate({
        set: {
          sourcePostingUrl: listing.sourcePostingUrl,
          originalApplyUrl: listing.originalApplyUrl,
          title: listing.title,
          employer: listing.employer,
          location: listing.location,
          locationKm: listing.locationKm,
          employmentType: listing.employmentType,
          description: listing.description,
          postedAt: listing.postedAt,
          expiresAt: listing.expiresAt,
          status: "active",
          analysis: { verificationNote: listing.verificationNote, skillMatches, seniorityMatch: listing.seniorityMatch },
          lastSeenAt: new Date(),
        },
      });
      const job = (await db.select().from(jobs).where(eq(jobs.fingerprint, fingerprint)).limit(1))[0];
      if (!job) throw new Error("Imported job could not be retrieved");
      if (!existing) newJobIds.add(job.id);
      await db.insert(scorecards).values({
        userId,
        jobId: job.id,
        roleAlignment: score.roleAlignment,
        resumeSkillMatch: score.resumeSkillMatch,
        seniorityAlignment: score.seniorityAlignment,
        locationCommuteFit: score.locationCommuteFit,
        employmentQualityFit: score.employmentQualityFit,
        recencyReadiness: score.recencyReadiness,
        penalties: score.penalties,
        totalScore: score.totalScore,
        rationale: score.rationale,
        notableGaps: score.notableGaps,
        evidence: score.evidence,
      }).onDuplicateKeyUpdate({
        set: {
          roleAlignment: score.roleAlignment,
          resumeSkillMatch: score.resumeSkillMatch,
          seniorityAlignment: score.seniorityAlignment,
          locationCommuteFit: score.locationCommuteFit,
          employmentQualityFit: score.employmentQualityFit,
          recencyReadiness: score.recencyReadiness,
          penalties: score.penalties,
          totalScore: score.totalScore,
          rationale: score.rationale,
          notableGaps: score.notableGaps,
          evidence: score.evidence,
          analyzedAt: new Date(),
        },
      });
      importedScores.push({ jobId: job.id, score });
    }

    const dateKey = getTorontoDateKey();
    const eligibleScores = await db
      .select({ jobId: jobs.id, totalScore: scorecards.totalScore })
      .from(scorecards)
      .innerJoin(jobs, eq(scorecards.jobId, jobs.id))
      .where(and(eq(scorecards.userId, userId), eq(jobs.status, "active")))
      .orderBy(desc(scorecards.totalScore));
    const shortlisted = eligibleScores
      .filter(item => item.totalScore >= settings[0].minimumScore)
      .slice(0, settings[0].shortlistLimit);
    await db.delete(shortlistEntries).where(and(eq(shortlistEntries.userId, userId), eq(shortlistEntries.dateKey, dateKey)));
    if (shortlisted.length) {
      await db.insert(shortlistEntries).values(shortlisted.map((item, index) => ({
        userId,
        runId,
        jobId: item.jobId,
        dateKey,
        rank: index + 1,
        score: item.totalScore,
        isNew: newJobIds.has(item.jobId),
      })));
    }
    await db.update(sourceConfigs).set({ lastStatus: "Verified fallback imported", lastCheckedAt: new Date() }).where(eq(sourceConfigs.id, source.id));
    await db.update(jobRuns).set({
      status: "completed",
      listingsCollected: listings.length,
      duplicatesMerged,
      jobsScored: importedScores.length,
      shortlistCount: shortlisted.length,
      completedAt: new Date(),
    }).where(eq(jobRuns.id, runId));
    if (settings[0].dailyNotificationEnabled && newJobIds.size > 0) {
      const newTopMatches = shortlisted
        .filter(item => newJobIds.has(item.jobId))
        .slice(0, 3)
        .map(item => `${item.totalScore}/100`)
        .join(", ");
      await notifyOwner({
        title: "Construction shortlist updated",
        content: `${newJobIds.size} verified new role${newJobIds.size === 1 ? "" : "s"} were added to today’s private shortlist. Top new fit scores: ${newTopMatches || "available in the dashboard"}. Review each original posting before preparing an application.`,
      });
    }
    return { runId, dateKey, imported: listings.length, duplicatesMerged, shortlisted: shortlisted.length };
  } catch (error) {
    await db.update(jobRuns).set({ status: "failed", errorSummary: error instanceof Error ? error.message : "Unknown import error", completedAt: new Date() }).where(eq(jobRuns.id, runId));
    throw error;
  }
}
