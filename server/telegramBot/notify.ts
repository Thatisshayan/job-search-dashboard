import { sendPlainMessage } from "../telegram";
import { listShortlist } from "../db";
import { getLocalDateKey } from "../utils/date";
import { prepareApplicationForTelegram } from "../applicationService";
import { runJobSearchForUser } from "./jobSearch";

/**
 * Runs a job search for a user and reports the outcome to their chat,
 * sending an approval card for each shortlisted job. Shared by the
 * post-onboarding one-off search (handler.ts) and the daily scheduler
 * (../scheduler.ts) so both paths behave identically.
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
    await sendPlainMessage(
      chatId,
      `Found it — ${outcome.imported} matching role${outcome.imported === 1 ? "" : "s"}, ${outcome.shortlisted} made today's shortlist. Review each one below and tap Approve to get a tailored resume + cover letter for it, or Decline to skip.`
    );
    const shortlist = await listShortlist(userId, getLocalDateKey("America/Toronto"));
    for (const item of shortlist) {
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
