import { sendPlainMessage } from "../telegram";
import { resolveTargetCities } from "../scoring";
import { getSearchSettingsForUser, setUserTargetCities } from "./db";

/**
 * Phase 12 (ROADMAP.md): manages *additional* search cities beyond a user's
 * primary one (searchSettings.city, still set via onboarding/`/edit`, still
 * required). A standalone command rather than an onboarding step or a
 * schema replacement — same low-friction, additive-migration reasoning
 * `/country`/`/generalwork` already established. `/cities add`/`remove`
 * only ever touch the *extra* list; the primary city stays `/edit`'s job,
 * since removing it would leave the required field with nothing to fall
 * back to.
 */
export async function handleCitiesCommand(chatId: string, userId: number, argument: string): Promise<void> {
  const settings = await getSearchSettingsForUser(userId);
  if (!settings) {
    await sendPlainMessage(chatId, "Finish onboarding first (send /start) before managing search cities.");
    return;
  }

  const trimmed = argument.trim();
  const spaceIndex = trimmed.indexOf(" ");
  const sub = (spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)).toLowerCase();
  const rest = (spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1)).trim();

  if (sub === "" || sub === "list") {
    const all = resolveTargetCities(settings);
    await sendPlainMessage(
      chatId,
      `Searching: ${all.join(", ")} (within ${settings.radiusKm} km of each)\n\nUsage: /cities add <city> — /cities remove <city> — /cities reset (back to just "${settings.city}")`
    );
    return;
  }

  if (sub === "reset") {
    await setUserTargetCities(userId, null);
    await sendPlainMessage(chatId, `Back to searching just "${settings.city}".`);
    return;
  }

  if (sub === "add") {
    if (!rest) {
      await sendPlainMessage(chatId, "Usage: /cities add <city> (e.g. /cities add Montreal, Quebec).");
      return;
    }
    const current = resolveTargetCities(settings);
    if (current.some(city => city.toLowerCase() === rest.toLowerCase())) {
      await sendPlainMessage(chatId, `Already searching "${rest}".`);
      return;
    }
    const extras = settings.targetCities ?? [];
    await setUserTargetCities(userId, [...extras, rest]);
    const all = [...current, rest];
    await sendPlainMessage(chatId, `Added "${rest}". Now searching: ${all.join(", ")}.`);
    return;
  }

  if (sub === "remove") {
    if (!rest) {
      await sendPlainMessage(chatId, "Usage: /cities remove <city>.");
      return;
    }
    const extras = settings.targetCities ?? [];
    const matchIndex = extras.findIndex(city => city.toLowerCase() === rest.toLowerCase());
    if (matchIndex === -1) {
      const isPrimary = settings.city.toLowerCase() === rest.toLowerCase();
      await sendPlainMessage(
        chatId,
        isPrimary
          ? `"${rest}" is your primary city — say /edit to change it instead, or /cities reset to drop the extras.`
          : `You're not searching "${rest}".`
      );
      return;
    }
    const nextExtras = extras.filter((_, index) => index !== matchIndex);
    await setUserTargetCities(userId, nextExtras);
    const all = resolveTargetCities({ city: settings.city, targetCities: nextExtras });
    await sendPlainMessage(chatId, `Removed "${rest}". Now searching: ${all.join(", ")}.`);
    return;
  }

  await sendPlainMessage(chatId, "Usage: /cities — /cities add <city> — /cities remove <city> — /cities reset");
}
