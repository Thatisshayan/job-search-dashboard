import { eq, and } from "drizzle-orm";
import { candidateProfiles, jobs, scorecards } from "../../drizzle/schema";
import { getDb } from "../db";
import { buildCoverLetterPdf, buildTailoredResumePdf, generateTailoredMaterials } from "../documentTailoring";
import { sendDocumentBuffer, sendPlainMessage } from "../telegram";

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "job";
}

/**
 * Generates and delivers tailored resume/cover-letter PDFs for one job, once
 * the user has actually approved it (see server/telegramWebhook.ts) — not
 * automatically for every shortlisted job. Keeps the LLM/PDF cost tied to
 * jobs the user actually said yes to, and matches Phase 7's human-in-the-loop
 * requirement (docs/telegram-agent/DECISIONS.md D2).
 */
export async function sendTailoredMaterialsForJob(chatId: string, userId: number, jobId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const [profileRows, jobRows, scorecardRows] = await Promise.all([
    db.select().from(candidateProfiles).where(eq(candidateProfiles.userId, userId)).limit(1),
    db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1),
    db.select().from(scorecards).where(and(eq(scorecards.userId, userId), eq(scorecards.jobId, jobId))).limit(1),
  ]);
  const profile = profileRows[0];
  const job = jobRows[0];
  if (!profile || !job) return;

  try {
    const materials = await generateTailoredMaterials({
      profile,
      job: { title: job.title, employer: job.employer, description: job.description },
      scoreRationale: scorecardRows[0]?.rationale,
    });
    const [resumePdf, coverLetterPdf] = await Promise.all([
      buildTailoredResumePdf(profile, materials),
      buildCoverLetterPdf(profile, job, materials),
    ]);
    const filenameBase = slug(job.employer);
    await sendDocumentBuffer({ chatId, filename: `resume-${filenameBase}.pdf`, buffer: resumePdf, caption: `Tailored resume — ${job.title} at ${job.employer}` });
    await sendDocumentBuffer({ chatId, filename: `cover-letter-${filenameBase}.pdf`, buffer: coverLetterPdf, caption: `Cover letter — ${job.title} at ${job.employer}` });
    if (materials.gapsToMention.length) {
      await sendPlainMessage(chatId, `Worth knowing before you apply to ${job.employer}:\n${materials.gapsToMention.map(item => `• ${item}`).join("\n")}`);
    }
  } catch (error) {
    console.error("[TelegramBot] Tailored-materials generation failed", error);
    // Non-fatal: the approval/original-link flow already completed, so the
    // user can still apply manually even if the tailoring step fails.
  }
}
