import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["admin", "user"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const candidateProfiles = mysqlTable(
  "candidate_profiles",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    displayName: varchar("displayName", { length: 160 }).notNull(),
    headline: varchar("headline", { length: 180 }).notNull(),
    location: varchar("location", { length: 180 }).notNull(),
    // Nullable: not every resume states an email/phone explicitly, and this
    // must never be guessed (same "don't invent facts" discipline as
    // education.year). Required at auto-submit time (Phase 10) since a real
    // application form needs contact info; the manual-link flow doesn't.
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 40 }),
    summary: text("summary").notNull(),
    skills: json("skills").$type<Record<string, string[]>>().notNull(),
    experience: json("experience").$type<Array<Record<string, unknown>>>().notNull(),
    education: json("education").$type<Array<Record<string, unknown>>>().notNull(),
    scoringGuardrails: json("scoringGuardrails").$type<string[]>().notNull(),
    resumeLabel: varchar("resumeLabel", { length: 255 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("candidate_profiles_user_unique").on(table.userId)],
);

export const searchSettings = mysqlTable(
  "search_settings",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    targetTitles: json("targetTitles").$type<string[]>().notNull(),
    city: varchar("city", { length: 120 }).notNull().default("Toronto, Ontario"),
    radiusKm: int("radiusKm").notNull().default(75),
    employmentTypes: json("employmentTypes").$type<string[]>().notNull(),
    minimumScore: int("minimumScore").notNull().default(60),
    shortlistLimit: int("shortlistLimit").notNull().default(20),
    timezone: varchar("timezone", { length: 80 }).notNull().default("America/Toronto"),
    scheduledTime: varchar("scheduledTime", { length: 20 }).notNull().default("07:30"),
    scheduleCronTaskUid: varchar("schedule_cron_task_uid", { length: 65 }),
    dailyNotificationEnabled: boolean("dailyNotificationEnabled").notNull().default(true),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("search_settings_user_unique").on(table.userId)],
);

export const sourceConfigs = mysqlTable(
  "source_configs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    name: varchar("name", { length: 120 }).notNull(),
    kind: mysqlEnum("kind", ["official", "employer", "licensed", "manual"]).notNull(),
    baseUrl: varchar("baseUrl", { length: 2048 }),
    credentialEnvKey: varchar("credentialEnvKey", { length: 120 }),
    enabled: boolean("enabled").notNull().default(true),
    lastStatus: varchar("lastStatus", { length: 80 }),
    lastCheckedAt: timestamp("lastCheckedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [index("source_configs_user_idx").on(table.userId)],
);

export const jobRuns = mysqlTable(
  "job_runs",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    status: mysqlEnum("status", ["running", "completed", "partial", "failed"]).notNull(),
    sourcesChecked: int("sourcesChecked").notNull().default(0),
    listingsCollected: int("listingsCollected").notNull().default(0),
    duplicatesMerged: int("duplicatesMerged").notNull().default(0),
    jobsScored: int("jobsScored").notNull().default(0),
    shortlistCount: int("shortlistCount").notNull().default(0),
    errorSummary: text("errorSummary"),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  table => [index("job_runs_user_started_idx").on(table.userId, table.startedAt)],
);

export const jobs = mysqlTable(
  "jobs",
  {
    id: int("id").autoincrement().primaryKey(),
    sourceConfigId: int("sourceConfigId"),
    sourceName: varchar("sourceName", { length: 120 }).notNull(),
    sourcePostingUrl: varchar("sourcePostingUrl", { length: 2048 }).notNull(),
    originalApplyUrl: varchar("originalApplyUrl", { length: 2048 }),
    sourceExternalId: varchar("sourceExternalId", { length: 255 }),
    fingerprint: varchar("fingerprint", { length: 255 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    employer: varchar("employer", { length: 255 }).notNull(),
    location: varchar("location", { length: 255 }).notNull(),
    locationKm: int("locationKm"),
    employmentType: varchar("employmentType", { length: 80 }),
    description: text("description").notNull(),
    postedAt: timestamp("postedAt"),
    expiresAt: timestamp("expiresAt"),
    status: mysqlEnum("status", ["active", "expired", "unavailable", "stale"]).notNull().default("active"),
    analysis: json("analysis").$type<Record<string, unknown>>(),
    firstSeenAt: timestamp("firstSeenAt").defaultNow().notNull(),
    lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("jobs_fingerprint_unique").on(table.fingerprint),
    index("jobs_status_posted_idx").on(table.status, table.postedAt),
  ],
);

export const scorecards = mysqlTable(
  "scorecards",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    jobId: int("jobId").notNull(),
    roleAlignment: int("roleAlignment").notNull(),
    resumeSkillMatch: int("resumeSkillMatch").notNull(),
    seniorityAlignment: int("seniorityAlignment").notNull(),
    locationCommuteFit: int("locationCommuteFit").notNull(),
    employmentQualityFit: int("employmentQualityFit").notNull(),
    recencyReadiness: int("recencyReadiness").notNull(),
    penalties: int("penalties").notNull().default(0),
    totalScore: int("totalScore").notNull(),
    rationale: text("rationale").notNull(),
    notableGaps: json("notableGaps").$type<string[]>().notNull(),
    evidence: json("evidence").$type<Array<Record<string, unknown>>>().notNull(),
    analyzedAt: timestamp("analyzedAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("scorecards_user_job_unique").on(table.userId, table.jobId),
    index("scorecards_user_score_idx").on(table.userId, table.totalScore),
  ],
);

export const shortlistEntries = mysqlTable(
  "shortlist_entries",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    runId: int("runId").notNull(),
    jobId: int("jobId").notNull(),
    dateKey: varchar("dateKey", { length: 10 }).notNull(),
    rank: int("rank").notNull(),
    score: int("score").notNull(),
    isNew: boolean("isNew").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    uniqueIndex("shortlist_entries_user_date_job_unique").on(table.userId, table.dateKey, table.jobId),
    index("shortlist_entries_user_date_rank_idx").on(table.userId, table.dateKey, table.rank),
  ],
);

export const jobActions = mysqlTable(
  "job_actions",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    jobId: int("jobId").notNull(),
    status: mysqlEnum("status", ["none", "saved", "opened", "applied", "not_interested", "reported_stale"])
      .notNull()
      .default("none"),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("job_actions_user_job_unique").on(table.userId, table.jobId)],
);

export const telegramConnections = mysqlTable(
  "telegram_connections",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    chatId: varchar("chatId", { length: 64 }).notNull(),
    botUsername: varchar("botUsername", { length: 128 }),
    verifiedAt: timestamp("verifiedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("telegram_connections_user_unique").on(table.userId), uniqueIndex("telegram_connections_chat_unique").on(table.chatId)],
);

export const botConversations = mysqlTable(
  "bot_conversations",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    chatId: varchar("chatId", { length: 64 }).notNull(),
    state: mysqlEnum("state", [
      "awaiting_resume",
      "awaiting_target_titles",
      "awaiting_location",
      "awaiting_radius",
      "idle",
    ]).notNull().default("awaiting_resume"),
    context: json("context").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [uniqueIndex("bot_conversations_chat_unique").on(table.chatId)],
);

export const applications = mysqlTable(
  "applications",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("userId").notNull(),
    jobId: int("jobId").notNull(),
    candidateProfileId: int("candidateProfileId").notNull(),
    telegramConnectionId: int("telegramConnectionId"),
    status: mysqlEnum("status", [
      "drafting",
      "awaiting_telegram_approval",
      "declined",
      "ready_for_final_confirmation",
      "ready_for_auto_submit_confirmation",
      "submitted",
      "not_pursuing",
      "expired",
    ]).notNull().default("drafting"),
    testMode: boolean("testMode").notNull().default(false),
    reviewPacket: json("reviewPacket").$type<Record<string, unknown>>().notNull(),
    approvalNonceHash: varchar("approvalNonceHash", { length: 128 }),
    approvalExpiresAt: timestamp("approvalExpiresAt"),
    telegramMessageId: int("telegramMessageId"),
    decisionCallbackId: varchar("decisionCallbackId", { length: 255 }),
    decisionAt: timestamp("decisionAt"),
    finalConfirmationAt: timestamp("finalConfirmationAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => [
    uniqueIndex("applications_user_job_unique").on(table.userId, table.jobId),
    index("applications_user_status_idx").on(table.userId, table.status),
    index("applications_nonce_idx").on(table.approvalNonceHash),
  ],
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type CandidateProfile = typeof candidateProfiles.$inferSelect;
export type SearchSettings = typeof searchSettings.$inferSelect;
export type SourceConfig = typeof sourceConfigs.$inferSelect;
export type JobRun = typeof jobRuns.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Scorecard = typeof scorecards.$inferSelect;
export type ShortlistEntry = typeof shortlistEntries.$inferSelect;
export type JobAction = typeof jobActions.$inferSelect;
export type TelegramConnection = typeof telegramConnections.$inferSelect;
export type Application = typeof applications.$inferSelect;
export type BotConversation = typeof botConversations.$inferSelect;
