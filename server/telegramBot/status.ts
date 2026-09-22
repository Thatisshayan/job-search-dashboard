import { eq } from "drizzle-orm";
import { candidateProfiles } from "../../drizzle/schema";
import { getDb } from "../db";
import { sendPlainMessage } from "../telegram";
import { resolveTargetCities } from "../scoring";
import { getSearchSettingsForUser, listGreenhouseWatches } from "./db";

/**
 * Read-only summary of everything already configurable via other commands
 * (/edit, /country, /generalwork, /watch) — a real gap flagged in
 * ROADMAP.md's Phase 8b as a nice-to-have: there was no single place to see
 * the whole current setup without running several commands separately.
 * Deliberately doesn't duplicate /watching's per-company list formatting —
 * just points there for the detail, to avoid two places that could drift.
 */
export async function handleStatusCommand(chatId: string, userId: number): Promise<void> {
  const settings = await getSearchSettingsForUser(userId);
  if (!settings) {
    await sendPlainMessage(chatId, "Nothing set up yet — send /start to begin.");
    return;
  }

  const db = await getDb();
  const profileRow = db
    ? (
        await db
          .select({ displayName: candidateProfiles.displayName, resumeLabel: candidateProfiles.resumeLabel })
          .from(candidateProfiles)
          .where(eq(candidateProfiles.userId, userId))
          .limit(1)
      )[0]
    : undefined;
  const watches = await listGreenhouseWatches(userId);

  const lines: string[] = [
    `Resume: ${profileRow ? `${profileRow.displayName || "on file"} (${profileRow.resumeLabel})` : "none on file"}`,
    `Track: ${settings.track === "general" ? "immediate/general work" : "career-focused"}`,
  ];

  if (settings.track === "career") {
    lines.push(`Target roles: ${settings.targetTitles.length ? settings.targetTitles.join(", ") : "none set"}`);
  }

  const cities = resolveTargetCities(settings);
  lines.push(
    `Location: ${cities.join(", ")} (within ${settings.radiusKm} km of each)`,
    `Search country: ${settings.country ? settings.country : "this deployment's default"}`,
    `Daily automatic check: ${settings.dailyNotificationEnabled ? `on, ${settings.scheduledTime} ${settings.timezone}` : "off — /edit to enable"}`,
    `General-work matching: ${settings.generalWorkEnabled ? "on" : "off"}`,
    watches.length ? `Watching ${watches.length} compan${watches.length === 1 ? "y" : "ies"} — see /watching for the list` : "Watching: no companies"
  );

  await sendPlainMessage(chatId, lines.join("\n"));
}
