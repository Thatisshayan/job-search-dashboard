import { sendPlainMessage } from "../telegram";
import { getSearchSettingsForUser, setGeneralWorkEnabled } from "./db";

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

  if (sub === "status" || sub === "") {
    await sendPlainMessage(chatId, settings.generalWorkEnabled ? "General-work matching is currently on." : "General-work matching is currently off. Say /generalwork on to enable it.");
    return;
  }

  await sendPlainMessage(chatId, `Usage: /generalwork on, /generalwork off, or /generalwork status.`);
}
