import { sendPlainMessage } from "../telegram";
import { isPlausibleCountryCode } from "../jobSearch/adzuna";
import { getSearchSettingsForUser, setUserCountry } from "./db";

/**
 * ROADMAP.md's Phase 4 "still open" note: Adzuna search runs against one
 * fixed country per deployment (ADZUNA_DEFAULT_COUNTRY, default "ca") —
 * without this, a user searching outside that country gets no results,
 * silently. This adds a per-user override, as a standalone command rather
 * than a mandatory onboarding step (same "simplified" reasoning Phase 14b
 * used for /generalwork) — most users never need it, so it shouldn't add
 * friction to the common case.
 */
export async function handleCountryCommand(chatId: string, userId: number, argument: string): Promise<void> {
  const settings = await getSearchSettingsForUser(userId);
  if (!settings) {
    await sendPlainMessage(chatId, "Finish onboarding first (send /start) before setting a search country.");
    return;
  }

  const sub = argument.trim();

  if (sub === "") {
    const current = settings.country
      ? `Your search country is currently set to "${settings.country}".`
      : "You haven't set a search country — using this deployment's default.";
    await sendPlainMessage(chatId, `${current}\n\nUsage: /country <two-letter code> (e.g. /country us), or /country reset to go back to the default.`);
    return;
  }

  if (sub.toLowerCase() === "reset") {
    await setUserCountry(userId, null);
    await sendPlainMessage(chatId, "Search country reset to this deployment's default.");
    return;
  }

  if (!isPlausibleCountryCode(sub)) {
    await sendPlainMessage(chatId, `"${sub}" doesn't look like a two-letter country code. Usage: /country <two-letter code> (e.g. /country us, /country gb).`);
    return;
  }

  const code = sub.toLowerCase();
  await setUserCountry(userId, code);
  // Honest caveat: this project can't confirm a single authoritative list of
  // every country Adzuna's API actually supports (see adzuna.ts's
  // isPlausibleCountryCode comment) — an unsupported code fails cleanly on
  // the next search rather than being silently rejected here.
  await sendPlainMessage(
    chatId,
    `Search country set to "${code}". Your next search will use it. If Adzuna doesn't actually support that code, searches will just come back empty rather than error out — say /country reset to go back to the default if that happens.`
  );
}
