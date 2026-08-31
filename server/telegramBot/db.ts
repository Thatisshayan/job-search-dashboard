import { and, eq } from "drizzle-orm";
import { botConversations, candidateProfiles, searchSettings, sourceConfigs, users } from "../../drizzle/schema";
import { getDb } from "../db";
import { bindTelegramConnection } from "../applicationService";

export type OnboardingState = "awaiting_resume" | "awaiting_target_titles" | "awaiting_location" | "awaiting_radius" | "idle";

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
    .values({ userId, chatId, state: "awaiting_resume", context: {} })
    .onDuplicateKeyUpdate({ set: { state: "awaiting_resume", context: {} } });
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

export type OnboardingSettings = { targetTitles: string[]; city: string; radiusKm: number };

export async function saveSearchSettingsFromOnboarding(userId: number, settings: OnboardingSettings) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const values = {
    userId,
    targetTitles: settings.targetTitles,
    city: settings.city,
    radiusKm: settings.radiusKm,
    employmentTypes: ["full-time"],
    minimumScore: 60,
    shortlistLimit: 20,
    timezone: "America/Toronto",
    scheduledTime: "07:30",
    dailyNotificationEnabled: true,
  };
  await db.insert(searchSettings).values(values).onDuplicateKeyUpdate({ set: values });
}

/**
 * importVerifiedListingBatch requires an existing, enabled sourceConfigs row
 * matching the batch's sourceName — auto-provision one for a bot user the
 * first time an automated search runs for them, rather than requiring a
 * manual registration step they'd otherwise have no UI for (Owner Tools'
 * "register a source" form is behind the website's OAuth login, which bot
 * users never have).
 */
export async function ensureSourceEnabled(userId: number, sourceName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const existing = (
    await db.select().from(sourceConfigs).where(and(eq(sourceConfigs.userId, userId), eq(sourceConfigs.name, sourceName))).limit(1)
  )[0];
  if (existing) {
    if (!existing.enabled) await db.update(sourceConfigs).set({ enabled: true }).where(eq(sourceConfigs.id, existing.id));
    return;
  }
  await db.insert(sourceConfigs).values({ userId, name: sourceName, kind: "licensed", enabled: true, lastStatus: "Auto-registered for bot-driven search" });
}
