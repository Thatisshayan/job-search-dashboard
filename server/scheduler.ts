import { desc, eq } from "drizzle-orm";
import { jobRuns, searchSettings, telegramConnections } from "../drizzle/schema";
import { getDb } from "./db";
import { runSearchAndNotify } from "./telegramBot/notify";
import { getLocalDateKey } from "./utils/date";

const CHECK_INTERVAL_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

export function currentHHMM(timeZone: string, date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const value = Object.fromEntries(parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${value.hour}:${value.minute}`;
}

async function alreadyRanToday(db: NonNullable<Awaited<ReturnType<typeof getDb>>>, userId: number, timezone: string): Promise<boolean> {
  const latest = (
    await db.select().from(jobRuns).where(eq(jobRuns.userId, userId)).orderBy(desc(jobRuns.startedAt)).limit(1)
  )[0];
  if (!latest) return false;
  return getLocalDateKey(timezone, latest.startedAt) === getLocalDateKey(timezone);
}

/**
 * Checked once a minute: for every user whose local clock currently reads
 * their configured scheduledTime and who hasn't already had a job run today
 * (in their own timezone), trigger a search and notify their paired Telegram
 * chat. Single in-process interval — fine for the current single-user scope;
 * revisit if this ever needs to survive across multiple server instances.
 */
async function tick(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const settingsRows = await db.select().from(searchSettings);
  for (const settings of settingsRows) {
    if (!settings.dailyNotificationEnabled) continue;
    if (currentHHMM(settings.timezone) !== settings.scheduledTime) continue;

    try {
      if (await alreadyRanToday(db, settings.userId, settings.timezone)) continue;

      const connection = (
        await db.select().from(telegramConnections).where(eq(telegramConnections.userId, settings.userId)).limit(1)
      )[0];
      if (!connection) continue;

      await runSearchAndNotify(connection.chatId, settings.userId);
    } catch (error) {
      console.error(`[scheduler] Daily search failed for user ${settings.userId}`, error);
    }
  }
}

export function startDailyScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch(error => console.error("[scheduler] tick failed", error));
  }, CHECK_INTERVAL_MS);
  timer.unref?.();
}
