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
  fromGreenhouseConfirmCallback,
  hashApprovalNonce,
  resolveSingleUseApproval,
  sendApprovalCard,
  sendPhotoBuffer,
  toGreenhouseConfirmCallback,
  verifyApprovalCallback,
} from "./telegram";
import { isGreenhouseApplyUrl, runGreenhouseApplication } from "./autoApply/greenhouse";
import { discardPendingGreenhouseSubmission, savePendingGreenhouseSubmission, takePendingGreenhouseSubmission } from "./autoApply/pendingSubmissions";
import { buildTailoredPackageForJob } from "./telegramBot/tailoring";

type ApplicationStatus =
  | "drafting"
  | "awaiting_telegram_approval"
  | "declined"
  | "ready_for_final_confirmation"
  | "ready_for_auto_submit_confirmation"
  | "submitted"
  | "not_pursuing"
  | "expired";

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

/**
 * Phase 10 / DECISIONS.md D5: after the existing Approve tap, if the job is
 * hosted on a supported ATS (currently Greenhouse only), this fills the real
 * apply form via `runGreenhouseApplication` in dry-run mode (no submit),
 * sends a screenshot of the filled form to the user, and puts the
 * application into `ready_for_auto_submit_confirmation` awaiting a second,
 * separately-worded CONFIRM/DECLINE — the one truly irreversible action
 * (the real submit click) never happens without that second explicit tap.
 */
export async function prepareGreenhouseAutoSubmitConfirmation(userId: number, jobId: number): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [application, job, connection] = await Promise.all([
    db.select().from(applications).where(and(eq(applications.userId, userId), eq(applications.jobId, jobId))).limit(1).then(rows => rows[0]),
    db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1).then(rows => rows[0]),
    db.select().from(telegramConnections).where(eq(telegramConnections.userId, userId)).limit(1).then(rows => rows[0]),
  ]);
  if (!application || !job || !connection) return { ok: false, reason: "Missing application, job, or Telegram pairing record." };
  if (!job.originalApplyUrl || !isGreenhouseApplyUrl(job.originalApplyUrl)) return { ok: false, reason: "Not a supported Greenhouse apply URL." };

  const pkg = await buildTailoredPackageForJob(userId, jobId);
  if (!pkg) return { ok: false, reason: "Candidate profile or job record is unavailable." };
  if (!pkg.profile.email) {
    return { ok: false, reason: "No email on file for this candidate — resumes must state a contact email before auto-submit can fill a real application form." };
  }

  const candidate = { fullName: pkg.profile.displayName, email: pkg.profile.email, phone: pkg.profile.phone ?? undefined };
  const result = await runGreenhouseApplication({
    applyUrl: job.originalApplyUrl,
    candidate,
    resumePdf: pkg.resumePdf,
    coverLetterText: pkg.materials.coverLetter,
    submit: false,
  });

  // Cache exactly what was just shown in the screenshot below — the real
  // submit on CONFIRM must use this, not a freshly (and non-deterministically)
  // regenerated resume/cover letter. See pendingSubmissions.ts.
  savePendingGreenhouseSubmission(application.id, { resumePdf: pkg.resumePdf, coverLetterText: pkg.materials.coverLetter, candidate });

  const nonce = crypto.randomBytes(18).toString("base64url");
  const approvalExpiresAt = new Date(Date.now() + 30 * 60_000);
  await db.update(applications).set({
    status: "ready_for_auto_submit_confirmation",
    approvalNonceHash: hashApprovalNonce(nonce),
    approvalExpiresAt,
  }).where(eq(applications.id, application.id));

  const questionsNote = result.unmappedQuestions.length
    ? `\n\nHeads up — this form also has questions I couldn't fill automatically, so they're still blank: ${result.unmappedQuestions.join("; ")}.`
    : "";
  const captchaNote = result.captchaDetected
    ? "\n\n⚠️ This page has bot-detection — I filled what I could, but automatic submission isn't possible here. Use the manual link instead."
    : "";
  const caption = `Filled (not submitted) — ${job.title} at ${job.employer}. This is exactly what would be sent if you confirm.${questionsNote}${captchaNote}`;

  await sendPhotoBuffer({ chatId: connection.chatId, filename: "application-preview.png", buffer: result.screenshot, caption });

  if (!result.captchaDetected) {
    await sendApprovalCard({
      chatId: connection.chatId,
      applicationId: application.id,
      title: `Submit this application to ${job.employer}?`,
      employer: job.employer,
      location: job.location,
      score: null,
      rationale: "This is the final, irreversible step — tapping Confirm submits the form above to the employer for real.",
      testMode: false,
      approveCallback: toGreenhouseConfirmCallback(createApprovalCallback(application.id, "approve", nonce)),
      declineCallback: toGreenhouseConfirmCallback(createApprovalCallback(application.id, "decline", nonce)),
    });
  }

  return { ok: true };
}

/**
 * Handles the second, separately-worded CONFIRM/DECLINE tap from
 * `prepareGreenhouseAutoSubmitConfirmation`'s screenshot message. Only on a
 * genuine, single-use, non-expired CONFIRM does the real submit click
 * happen — see DECISIONS.md D5.
 */
export async function processGreenhouseConfirmationCallback(input: { callbackId: string; chatId: string; data: string }) {
  const unwrapped = fromGreenhouseConfirmCallback(input.data);
  const callback = unwrapped ? verifyApprovalCallback(unwrapped) : null;
  if (!callback) return { state: "ignored" as const, text: "This confirmation is invalid or has been altered." };
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const application = (await db.select().from(applications).where(eq(applications.id, callback.applicationId)).limit(1))[0];
  if (!application) return { state: "ignored" as const, text: "This application record is unavailable." };
  const job = (await db.select().from(jobs).where(eq(jobs.id, application.jobId)).limit(1))[0];
  if (!job || !job.originalApplyUrl) return { state: "ignored" as const, text: "The related job record is unavailable." };

  const targetStatus = resolveSingleUseApproval({
    currentStatus: application.status,
    storedNonceHash: application.approvalNonceHash,
    expiresAt: application.approvalExpiresAt,
    nonce: callback.nonce,
    decision: callback.decision,
    expectedStatus: "ready_for_auto_submit_confirmation",
    approvedStatus: "submitted",
    declinedStatus: "declined",
  });
  if (!targetStatus) return { state: "ignored" as const, text: "This confirmation is no longer valid or has expired." };
  const connection = (await db.select().from(telegramConnections).where(eq(telegramConnections.userId, application.userId)).limit(1))[0];
  if (!connection || connection.id !== application.telegramConnectionId || connection.chatId !== input.chatId) return { state: "ignored" as const, text: "This Telegram chat is not authorized for this confirmation." };

  // Claim the nonce first (single-use, same anti-replay pattern as the
  // original Approve callback). For "approve," land on
  // ready_for_final_confirmation as the interim/fallback status — if the
  // process crashes between this line and the actual submit attempt below,
  // that's exactly the safe manual-link state to be stuck in, not a
  // half-submitted unknown.
  const claimResult = await db.update(applications).set({
    status: targetStatus === "submitted" ? "ready_for_final_confirmation" : targetStatus,
    approvalNonceHash: null,
    decisionCallbackId: input.callbackId,
    decisionAt: new Date(),
  }).where(and(eq(applications.id, application.id), eq(applications.status, "ready_for_auto_submit_confirmation"), eq(applications.approvalNonceHash, hashApprovalNonce(callback.nonce))));
  const header = (Array.isArray(claimResult) ? claimResult[0] : claimResult) as { affectedRows?: number };
  if (header.affectedRows !== 1) return { state: "ignored" as const, text: "This confirmation was already handled." };

  if (targetStatus === "declined") {
    discardPendingGreenhouseSubmission(application.id);
    return { state: "declined" as const, applicationId: application.id, text: "Submission declined. Nothing was sent to the employer." };
  }

  // Must use exactly what the dry-run screenshot showed — never regenerate
  // here, since a fresh LLM call could silently produce different content
  // than what the user actually reviewed and confirmed. If the cache is
  // gone (process restarted, or the 30-minute window lapsed), fail safe to
  // the manual-link flow rather than submit something unreviewed.
  const pending = takePendingGreenhouseSubmission(application.id);
  if (!pending) {
    await db.update(applications).set({ status: "ready_for_final_confirmation" }).where(eq(applications.id, application.id));
    return { state: "failed" as const, applicationId: application.id, text: "The reviewed version of this application is no longer available — falling back to the manual apply link. Nothing was sent. Tap Approve again to regenerate and re-review." };
  }

  try {
    const result = await runGreenhouseApplication({
      applyUrl: job.originalApplyUrl,
      candidate: pending.candidate,
      resumePdf: pending.resumePdf,
      coverLetterText: pending.coverLetterText,
      submit: true,
    });
    if (!result.submitted) throw new Error("Submission did not complete");
    await db.update(applications).set({ status: "submitted", finalConfirmationAt: new Date() }).where(eq(applications.id, application.id));
    await sendPhotoBuffer({ chatId: connection.chatId, filename: "application-submitted.png", buffer: result.screenshot, caption: `Submitted — ${job.title} at ${job.employer}.` });
    return { state: "submitted" as const, applicationId: application.id, text: "Submitted. This cannot be undone." };
  } catch (error) {
    console.error(`[applicationService] Greenhouse submission failed for application ${application.id}`, error);
    await db.update(applications).set({ status: "ready_for_final_confirmation" }).where(eq(applications.id, application.id));
    return { state: "failed" as const, applicationId: application.id, text: "Automatic submission failed — falling back to the manual apply link. Nothing was sent to the employer." };
  }
}
