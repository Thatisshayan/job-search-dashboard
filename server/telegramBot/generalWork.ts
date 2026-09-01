import { sendPlainMessage } from "../telegram";
import { prepareApplicationForTelegram } from "../applicationService";
import { getSearchSettingsForUser, setGeneralWorkEnabled } from "./db";
import { runGeneralWorkSearchForUser } from "./jobSearch";

/**
 * Phase 14b: on/off/status for the general-work track. Enabling this does
 * not run anything by itself — it only unlocks the (not yet built, Phase
 * 14c) on-request /generalwork run step, kept fully separate from the
 * daily main-track search per the 2026-09-01 scoping decision.
 */
export async function handleGeneralWorkCommand(chatId: string, userId: number, argument: string): Promise<void> {
  const settings = await getSearchSettingsForUser(userId);
  if (!settings) {
    await sendPlainMessage(chatId, "Finish onboarding first (send /start) before turning on general-work matching.");
    return;
  }

  const sub = argument.trim().toLowerCase();

  if (sub === "on") {
    await setGeneralWorkEnabled(userId, true);
    await sendPlainMessage(
      chatId,
      "General-work matching is on. This won't search or send you anything by itself yet — that part's still being built. Say /generalwork off to turn it back off."
    );
    return;
  }

  if (sub === "off") {
    await setGeneralWorkEnabled(userId, false);
    await sendPlainMessage(chatId, "General-work matching is off.");
    return;
  }

  if (sub === "status") {
    await sendPlainMessage(chatId, settings.generalWorkEnabled ? "General-work matching is currently on." : "General-work matching is currently off. Say /generalwork on to enable it.");
    return;
  }

  if (sub === "run") {
    if (!settings.generalWorkEnabled) {
      await sendPlainMessage(chatId, "General-work matching is off. Say /generalwork on first, then /generalwork run.");
      return;
    }
    await runGeneralWork(chatId, userId);
    return;
  }

  if (sub === "") {
    await sendPlainMessage(chatId, settings.generalWorkEnabled ? "General-work matching is currently on. Say /generalwork run to search now." : "General-work matching is currently off. Say /generalwork on to enable it.");
    return;
  }

  await sendPlainMessage(chatId, `Usage: /generalwork on, /generalwork off, /generalwork status, or /generalwork run.`);
}

/**
 * Fully separate from runSearchAndNotify's daily career-track flow — its
 * own search, its own messages, its own Approve/Decline cards, never
 * touching the main shortlist. This is deliberate (per the 2026-09-01
 * scoping decision): general-work results are never interleaved into the
 * daily stream, only ever shown when explicitly requested here.
 */
async function runGeneralWork(chatId: string, userId: number): Promise<void> {
  await sendPlainMessage(chatId, "Searching for general-work opportunities now, one moment…");

  const outcome = await runGeneralWorkSearchForUser(userId);
  if (!outcome.ok) {
    const text =
      outcome.reason === "not_configured"
        ? "General-work search isn't fully set up on this deployment yet."
        : outcome.reason === "no_settings"
          ? "Finish onboarding first (send /start)."
          : "I didn't find any general-work roles just now. Try again later.";
    await sendPlainMessage(chatId, text);
    return;
  }

  if (outcome.newJobs.length === 0) {
    await sendPlainMessage(chatId, `Found ${outcome.found} general-work role${outcome.found === 1 ? "" : "s"}, but you've already reviewed all of them.`);
    return;
  }

  await sendPlainMessage(chatId, `Found ${outcome.newJobs.length} new general-work role${outcome.newJobs.length === 1 ? "" : "s"} to review. Approve/Decline buttons follow below — this is separate from your main career-track search.`);

  for (const job of outcome.newJobs) {
    if (!job.originalApplyUrl) continue;
    try {
      await prepareApplicationForTelegram(userId, job.jobId);
    } catch (error) {
      console.error(`[TelegramBot] Could not prepare general-work approval card for job ${job.jobId}`, error);
    }
  }
}
