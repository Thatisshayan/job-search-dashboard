import { sendDocumentBuffer, sendPlainMessage } from "../telegram";
import { getProfile, listShortlist } from "../db";
import { getLocalDateKey } from "../utils/date";
import { prepareApplicationForTelegram } from "../applicationService";
import { buildShortlistSummaryPdf, type ShortlistSummaryRow } from "../documentTailoring";
import { runJobSearchForUser } from "./jobSearch";

/**
 * Runs a job search for a user and reports the outcome to their chat: a
 * one-page PDF overview of everything newly eligible today, followed by an
 * Approve/Decline card per job. Shared by the post-onboarding one-off search
 * (handler.ts) and the daily scheduler (../scheduler.ts) so both paths
 * behave identically.
 *
 * Jobs that already have an `applications` row (an approval card was already
 * sent for them on a previous run, decided or not) are skipped — a job that
 * stays posted across multiple days should never be re-asked about.
 */
export async function runSearchAndNotify(chatId: string, userId: number): Promise<void> {
  try {
    const outcome = await runJobSearchForUser(userId);
    if (!outcome.ok) {
      const reasonText =
        outcome.reason === "not_configured"
          ? "Job search isn't fully set up on this deployment yet — I've saved your profile and preferences, and I'll search as soon as it is."
          : outcome.reason === "no_results"
            ? "I didn't find any matching roles just now. I'll keep checking."
            : "I couldn't run a search just now — your profile and preferences are saved, though.";
      await sendPlainMessage(chatId, reasonText);
      return;
    }
    if (outcome.shortlisted === 0) {
      await sendPlainMessage(chatId, `Found ${outcome.imported} role${outcome.imported === 1 ? "" : "s"}, but none scored high enough for today's shortlist yet.`);
      return;
    }

    const dateKey = getLocalDateKey("America/Toronto");
    const shortlist = await listShortlist(userId, dateKey);
    const undecided = shortlist.filter(item => !item.application);
    const alreadyDecided = shortlist.length - undecided.length;

    if (undecided.length === 0) {
      await sendPlainMessage(
        chatId,
        `Found ${outcome.imported} role${outcome.imported === 1 ? "" : "s"} today, but you've already reviewed everything on the shortlist (${alreadyDecided} previously decided). I'll message you again once something new turns up.`
      );
      return;
    }

    const profile = await getProfile(userId);
    const rows: ShortlistSummaryRow[] = undecided.map(item => ({
      rank: item.entry.rank,
      score: item.scorecard.totalScore,
      title: item.job.title,
      employer: item.job.employer,
      location: item.job.location,
      originalApplyUrl: item.job.originalApplyUrl,
    }));
    try {
      const summaryPdf = await buildShortlistSummaryPdf({ candidateName: profile?.displayName ?? "", dateKey, rows });
      await sendDocumentBuffer({ chatId, filename: `shortlist-${dateKey}.pdf`, buffer: summaryPdf, caption: `${undecided.length} new role${undecided.length === 1 ? "" : "s"} to review${alreadyDecided ? ` (${alreadyDecided} already decided, not repeated)` : ""}. Approve/Decline buttons follow below.` });
    } catch (error) {
      console.error("[TelegramBot] Could not build/send shortlist summary PDF", error);
      await sendPlainMessage(
        chatId,
        `Found it — ${undecided.length} new matching role${undecided.length === 1 ? "" : "s"} to review. Review each one below and tap Approve to get a tailored resume + cover letter for it, or Decline to skip.`
      );
    }

    for (const item of undecided) {
      if (!item.job.originalApplyUrl) continue;
      try {
        await prepareApplicationForTelegram(userId, item.job.id);
      } catch (error) {
        console.error(`[TelegramBot] Could not prepare approval card for job ${item.job.id}`, error);
      }
    }
  } catch (error) {
    console.error("[TelegramBot] Job search failed", error);
    await sendPlainMessage(chatId, "I ran into an error searching just now — your profile and preferences are saved, and I'll retry later.");
  }
}
