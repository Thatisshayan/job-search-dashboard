import { and, eq } from "drizzle-orm";
import { botConversations, candidateProfiles, searchSettings, sourceConfigs, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { bindTelegramConnection } from "../applicationService";

export type OnboardingState =
  | "awaiting_track_choice"
  | "awaiting_resume_choice"
  | "awaiting_resume"
  | "awaiting_resume_build"
  | "awaiting_target_titles"
  | "awaiting_location"
  | "awaiting_radius"
  | "awaiting_recurring_choice"
  | "awaiting_recurring_time"
  | "idle";

/**
 * Resolves the app user behind a Telegram chat, creating one on first
 * contact. This is the identity boundary for the bot-first flow: a chat's
 * openId is synthetic (`telegram:<chatId>`), independent of the Manus OAuth
 * users the website login still uses, so onboarding via the bot never needs
 * OAuth at all.
 */
export async function getOrCreateUserForChat(chatId: string, botUsername: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");

  const openId = `telegram:${chatId}`;
  const existing = (await db.select().from(users).where(eq(users.openId, openId)).limit(1))[0];
  if (existing) return existing;

  await db.insert(users).values({ openId, loginMethod: "telegram", role: "user", lastSignedIn: new Date() });
  const created = (await db.select().from(users).where(eq(users.openId, openId)).limit(1))[0];
  if (!created) throw new Error("Failed to create user for Telegram chat");

  await bindTelegramConnection(created.id, chatId, botUsername);
  return created;
}

export async function getConversation(chatId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return (await db.select().from(botConversations).where(eq(botConversations.chatId, chatId)).limit(1))[0];
}

export async function startConversation(userId: number, chatId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(botConversations)
    .values({ userId, chatId, state: "awaiting_track_choice", context: {} })
    .onDuplicateKeyUpdate({ set: { state: "awaiting_track_choice", context: {} } });
}

export async function setConversationState(chatId: string, state: OnboardingState, context: Record<string, unknown>) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(botConversations).set({ state, context }).where(eq(botConversations.chatId, chatId));
}

export type ParsedResumeProfile = {
  displayName: string;
  headline: string;
  location: string;
  email: string | null;
  phone: string | null;
  summary: string;
  skills: Record<string, string[]>;
  experience: Array<Record<string, unknown>>;
  education: Array<Record<string, unknown>>;
  resumeLabel: string;
};

export async function saveCandidateProfile(userId: number, profile: ParsedResumeProfile) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const values = {
    userId,
    displayName: profile.displayName,
    headline: profile.headline,
    location: profile.location,
    email: profile.email,
    phone: profile.phone,
    summary: profile.summary,
    skills: profile.skills,
    experience: profile.experience,
    education: profile.education,
    scoringGuardrails: [
      "Do not infer professional licensure.",
      "Do not infer work authorization.",
      "Do not assume certifications that are absent from the resume.",
      "Flag material qualification gaps rather than guessing.",
    ],
    resumeLabel: profile.resumeLabel,
  };
  await db.insert(candidateProfiles).values(values).onDuplicateKeyUpdate({ set: values });
}

export type OnboardingSettings = {
  track: "career" | "general";
  targetTitles: string[];
  city: string;
  radiusKm: number;
  dailyNotificationEnabled: boolean;
  scheduledTime: string;
};

export async function saveSearchSettingsFromOnboarding(userId: number, settings: OnboardingSettings) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const values = {
    userId,
    track: settings.track,
    // The immediate/career choice made at onboarding also flips the existing
    // generalWorkEnabled flag, so /generalwork status|run keep working
    // unchanged for a user who picked the immediate-hiring track up front.
    generalWorkEnabled: settings.track === "general",
    targetTitles: settings.targetTitles,
    city: settings.city,
    radiusKm: settings.radiusKm,
    employmentTypes: ["full-time"],
    minimumScore: 60,
    shortlistLimit: 20,
    timezone: "America/Toronto",
    scheduledTime: settings.scheduledTime,
    dailyNotificationEnabled: settings.dailyNotificationEnabled,
  };
  await db.insert(searchSettings).values(values).onDuplicateKeyUpdate({ set: values });
}

/**
 * Reads back a bot user's own search_settings row directly (no
 * ensureDashboardSetup side effect — that's the website/public-workspace
 * flow's helper in server/db.ts; bot users are provisioned via
 * getOrCreateUserForChat/saveSearchSettingsFromOnboarding instead).
 */
export async function getSearchSettingsForUser(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return (await db.select().from(searchSettings).where(eq(searchSettings.userId, userId)).limit(1))[0];
}

/**
 * Phase 14b: toggles the general-work track's enablement. Does not itself
 * start a search — see /generalwork's "run" step (Phase 14c, not yet
 * built), which checks this flag before running.
 */
export async function setGeneralWorkEnabled(userId: number, enabled: boolean): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(searchSettings).set({ generalWorkEnabled: enabled }).where(eq(searchSettings.userId, userId));
}

/**
 * Sets (or, with `null`, clears back to the deployment's ADZUNA_DEFAULT_COUNTRY
 * fallback) a user's own two-letter Adzuna country code. See /country
 * (telegramBot/country.ts) and jobSearch/adzuna.ts's isPlausibleCountryCode.
 */
export async function setUserCountry(userId: number, country: string | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(searchSettings).set({ country }).where(eq(searchSettings.userId, userId));
}

/**
 * Phase 12: sets the *additional* cities beyond a user's primary `city` (see
 * scoring.ts's resolveTargetCities). `null`/empty clears back to single-city
 * mode. /cities (telegramBot/cities.ts) is the only caller.
 */
export async function setUserTargetCities(userId: number, targetCities: string[] | null): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.update(searchSettings).set({ targetCities: targetCities && targetCities.length > 0 ? targetCities : null }).where(eq(searchSettings.userId, userId));
}

/**
 * importVerifiedListingBatch requires an existing, enabled sourceConfigs row
 * matching the batch's sourceName — auto-provision one for a bot user the
 * first time an automated search runs for them, rather than requiring a
 * manual registration step they'd otherwise have no UI for (Owner Tools'
 * "register a source" form is behind the website's OAuth login, which bot
 * users never have).
 */
/**
 * A native MySQL upsert against sourceConfigs' (userId, name) unique
 * constraint — atomic at the database level, so two concurrent calls for the
 * same user+source (e.g. two overlapping scheduler ticks) can never create
 * duplicate rows the way a read-then-insert could. See docs/superpowers/
 * specs/2026-09-12-multi-tenant-stability-design.md, Fix 2.
 */
export async function ensureSourceEnabled(userId: number, sourceName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(sourceConfigs)
    .values({ userId, name: sourceName, kind: "licensed", enabled: true, lastStatus: "Auto-registered for bot-driven search" })
    .onDuplicateKeyUpdate({ set: { enabled: true } });
}

/**
 * Second discovery source (Phase 10 follow-up, DECISIONS.md D5's update
 * note): a user-registered "watch this company's Greenhouse board"
 * source. `sourceConfigs.name` holds the same `Greenhouse:<token>` value
 * `greenhouseBoardSourceName()` produces, so `importVerifiedListingBatch`'s
 * existing name-based lookup works unchanged for this source too.
 */
export async function registerGreenhouseWatch(userId: number, sourceName: string, boardToken: string, companyName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const values = {
    userId,
    name: sourceName,
    kind: "employer" as const,
    baseUrl: `https://boards-api.greenhouse.io/v1/boards/${boardToken}`,
    enabled: true,
    lastStatus: `Watching ${companyName}'s Greenhouse board`,
  };
  // Native upsert, same reasoning as ensureSourceEnabled above.
  await db.insert(sourceConfigs).values(values).onDuplicateKeyUpdate({ set: values });
}

export async function disableGreenhouseWatch(userId: number, sourceName: string): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = (
    await db.select().from(sourceConfigs).where(and(eq(sourceConfigs.userId, userId), eq(sourceConfigs.name, sourceName))).limit(1)
  )[0];
  if (!existing) return false;
  await db.update(sourceConfigs).set({ enabled: false }).where(eq(sourceConfigs.id, existing.id));
  return true;
}

export async function listGreenhouseWatches(userId: number): Promise<Array<{ name: string; lastStatus: string | null }>> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const rows = await db
    .select({ name: sourceConfigs.name, lastStatus: sourceConfigs.lastStatus })
    .from(sourceConfigs)
    .where(and(eq(sourceConfigs.userId, userId), eq(sourceConfigs.kind, "employer"), eq(sourceConfigs.enabled, true)));
  return rows.filter(row => row.name.startsWith("Greenhouse:"));
}
