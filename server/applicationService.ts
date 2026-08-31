import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  applications,
  candidateProfiles,
  jobs,
  scorecards,
  telegramConnections,
} from "../drizzle/schema";
import { getDb } from "./db";
import {
  createApprovalCallback,
  hashApprovalNonce,
  resolveSingleUseApproval,
  sendApprovalCard,
  verifyApprovalCallback,
} from "./telegram";

type ApplicationStatus = "drafting" | "awaiting_telegram_approval" | "declined" | "ready_for_final_confirmation" | "submitted" | "not_pursuing" | "expired";

function asStringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function flattenedSkills(skills: Record<string, string[]>) {
  return Object.values(skills).flat().slice(0, 6);
}

function reviewPacket(profile: typeof candidateProfiles.$inferSelect, job: typeof jobs.$inferSelect, scorecard: typeof scorecards.$inferSelect | undefined, testMode: boolean) {
  const skills = flattenedSkills(profile.skills);
  return {
    candidate: {
      displayName: profile.displayName,
      headline: profile.headline,
      resumeLabel: profile.resumeLabel,
      verifiedSkills: skills,
    },
    job: {
      title: job.title,
      employer: job.employer,
      location: job.location,
      originalApplyUrl: job.originalApplyUrl,
      testMode,
    },
    score: scorecard ? {
      total: scorecard.totalScore,
      rationale: scorecard.rationale,
      notableGaps: asStringList(scorecard.notableGaps),
      evidence: scorecard.evidence,
    } : null,
    submissionBoundary: "Telegram approval prepares this one review for final browser confirmation; it does not submit an employer application.",
  };
}

export async function bindTelegramConnection(userId: number, chatId: string, botUsername: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(telegramConnections).values({ userId, chatId, botUsername }).onDuplicateKeyUpdate({ set: { chatId, botUsername, verifiedAt: new Date() } });
  return (await db.select().from(telegramConnections).where(eq(telegramConnections.userId, userId)).limit(1))[0];
}

export async function prepareApplicationForTelegram(userId: number, jobId: number, testMode = false) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [profile, job, connection, scorecard] = await Promise.all([
    db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId)).limit(1),
    db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1),
    db.select().from(telegramConnections).where(eq(telegramConnections.userId, userId)).limit(1),
    db.select().from(scorecards).where(and(eq(scorecards.userId, userId), eq(scorecards.jobId, jobId))).limit(1),
  ]);
  if (!profile[0] || !job[0]) throw new Error("A verified candidate profile and selected job are required");
  if (!connection[0]) throw new Error("Telegram is not paired to this private dashboard");
  if (!testMode && (!job[0].originalApplyUrl || job[0].status !== "active")) throw new Error("Only active jobs with a verified original application link can be prepared");

  const nonce = crypto.randomBytes(18).toString("base64url");
  const approvalExpiresAt = new Date(Date.now() + 30 * 60_000);
  const packet = reviewPacket(profile[0], job[0], scorecard[0], testMode);
  await db.insert(applications).values({
    userId,
    jobId,
    candidateProfileId: profile[0].id,
    telegramConnectionId: connection[0].id,
    status: "awaiting_telegram_approval",
    testMode,
    reviewPacket: packet,
    approvalNonceHash: hashApprovalNonce(nonce),
    approvalExpiresAt,
  }).onDuplicateKeyUpdate({
    set: {
      telegramConnectionId: connection[0].id,
      status: "awaiting_telegram_approval",
      testMode,
      reviewPacket: packet,
      approvalNonceHash: hashApprovalNonce(nonce),
      approvalExpiresAt,
      decisionCallbackId: null,
      decisionAt: null,
      finalConfirmationAt: null,
    },
  });
  const application = (await db.select().from(applications).where(and(eq(applications.userId, userId), eq(applications.jobId, jobId))).limit(1))[0];
  if (!application) throw new Error("Application record could not be prepared");

  const message = await sendApprovalCard({
    chatId: connection[0].chatId,
    applicationId: application.id,
    title: job[0].title,
    employer: job[0].employer,
    location: job[0].location,
    score: scorecard[0]?.totalScore ?? null,
    rationale: scorecard[0]?.rationale ?? "This test review uses verified candidate-profile evidence.",
    testMode,
    approveCallback: createApprovalCallback(application.id, "approve", nonce),
    declineCallback: createApprovalCallback(application.id, "decline", nonce),
  });
  await db.update(applications).set({ telegramMessageId: message.message_id }).where(eq(applications.id, application.id));
  return (await db.select().from(applications).where(eq(applications.id, application.id)).limit(1))[0];
}

export async function createResumeBackedTestJob(userId: number, fresh = false) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const fingerprint = fresh ? `telegram-e2e-test-${userId}-${Date.now()}` : `telegram-e2e-test-${userId}`;
  let job = (await db.select().from(jobs).where(eq(jobs.fingerprint, fingerprint)).limit(1))[0];
  if (!job) {
    await db.insert(jobs).values({
      sourceName: "Internal workflow test",
      sourcePostingUrl: "https://example.test/telegram-approval-workflow",
      fingerprint,
      title: "Test-only Project Coordinator Review",
      employer: "Workflow Integration Test — Not an Employer",
      location: "Toronto, Ontario",
      employmentType: "full-time",
      description: "Non-actionable workflow test record used only to verify that resume-backed evidence and Telegram approvals reach final browser-ready status without contacting an employer.",
      status: "unavailable",
    });
    job = (await db.select().from(jobs).where(eq(jobs.fingerprint, fingerprint)).limit(1))[0];
  }
  const profile = (await db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId)).limit(1))[0];
  if (!profile || !job) throw new Error("Candidate profile or test job is unavailable");
  const evidence = flattenedSkills(profile.skills).map(skill => ({ type: "verified_resume_skill", skill }));
  await db.insert(scorecards).values({
    userId,
    jobId: job.id,
    roleAlignment: 28,
    resumeSkillMatch: 23,
    seniorityAlignment: 14,
    locationCommuteFit: 10,
    employmentQualityFit: 10,
    recencyReadiness: 0,
    penalties: -5,
    totalScore: 80,
    rationale: "Test-only review based on the verified candidate profile’s project coordination, scheduling, scope documentation, and trade-management evidence. This is not a live vacancy or application recommendation.",
    notableGaps: ["This is a non-actionable integration-test record, not a live employer posting."],
    evidence,
  }).onDuplicateKeyUpdate({ set: { analyzedAt: new Date(), evidence } });
  return job;
}

export async function processTelegramApprovalCallback(input: { callbackId: string; chatId: string; data: string }) {
  const callback = verifyApprovalCallback(input.data);
  if (!callback) return { state: "ignored" as const, text: "This approval request is invalid or has been altered." };
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const application = (await db.select().from(applications).where(eq(applications.id, callback.applicationId)).limit(1))[0];
  if (!application || application.status !== "awaiting_telegram_approval") return { state: "ignored" as const, text: "This application review was already handled." };
  const job = (await db.select().from(jobs).where(eq(jobs.id, application.jobId)).limit(1))[0];
  if (!job) return { state: "ignored" as const, text: "The related job record is unavailable." };
  const targetStatus = resolveSingleUseApproval({
    currentStatus: application.status,
    storedNonceHash: application.approvalNonceHash,
    expiresAt: application.approvalExpiresAt,
    nonce: callback.nonce,
    decision: callback.decision,
  });
  if (!targetStatus) return { state: "ignored" as const, text: "This approval request is no longer valid or has expired." };
  const connection = (await db.select().from(telegramConnections).where(eq(telegramConnections.userId, application.userId)).limit(1))[0];
  if (!connection || connection.id !== application.telegramConnectionId || connection.chatId !== input.chatId) return { state: "ignored" as const, text: "This Telegram chat is not authorized for this review." };

  const updateResult = await db.update(applications).set({
    status: targetStatus,
    approvalNonceHash: null,
    decisionCallbackId: input.callbackId,
    decisionAt: new Date(),
  }).where(and(eq(applications.id, application.id), eq(applications.status, "awaiting_telegram_approval"), eq(applications.approvalNonceHash, hashApprovalNonce(callback.nonce))));
  const header = (Array.isArray(updateResult) ? updateResult[0] : updateResult) as { affectedRows?: number };
  if (header.affectedRows !== 1) return { state: "ignored" as const, text: "This application review was already handled." };
  return {
    state: targetStatus,
    applicationId: application.id,
    userId: application.userId,
    jobId: application.jobId,
    telegramMessageId: application.telegramMessageId,
    originalApplyUrl: targetStatus === "ready_for_final_confirmation" ? job.originalApplyUrl : null,
    jobTitle: job.title,
    employer: job.employer,
    text: targetStatus === "declined" ? "Application review declined." : "Approved for final browser confirmation. No employer application was submitted.",
  };
}
