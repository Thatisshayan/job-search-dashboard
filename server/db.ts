import { and, asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  applications,
  candidateProfiles,
  InsertUser,
  jobActions,
  jobRuns,
  jobs,
  scorecards,
  searchSettings,
  shortlistEntries,
  sourceConfigs,
  users,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let publicWorkspaceBootstrap: Promise<number> | null = null;
const PUBLIC_WORKSPACE_OPEN_ID = "public-workspace-shayan-salimi";

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    _db = drizzle(process.env.DATABASE_URL);
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = {
    openId: user.openId,
    lastSignedIn: user.lastSignedIn ?? new Date(),
  };
  const updateSet: Record<string, unknown> = {
    lastSignedIn: values.lastSignedIn,
  };
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] as never;
      updateSet[field] = user[field] ?? null;
    }
  }
  const enforcedRole =
    user.openId === ENV.ownerOpenId ? "admin" : (user.role ?? "user");
  values.role = enforcedRole;
  updateSet.role = enforcedRole;
  await db
    .insert(users)
    .values(values)
    .onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);
  return result[0];
}

export async function getPublicWorkspaceUserId() {
  const db = await getDb();
  if (!db) throw new Error("The public workspace database is unavailable");

  const configuredOwner = await getUserByOpenId(ENV.ownerOpenId);
  if (configuredOwner) return configuredOwner.id;

  // Public mode is intentionally a single-candidate dashboard. If the deployed
  // owner environment identifier has not been propagated yet, use the persisted
  // admin owner record rather than failing all read-only public queries.
  const persistedAdmin = (
    await db.select().from(users).where(eq(users.role, "admin")).limit(1)
  )[0];
  if (persistedAdmin) return persistedAdmin.id;

  const onlyWorkspaceUser = (await db.select().from(users).limit(1))[0];
  if (onlyWorkspaceUser) return onlyWorkspaceUser.id;

  // The candidate's name/experience are intentionally public (this dashboard's whole
  // purpose is a transparent, evidence-backed shortlist), but contact info is not
  // read by any public query today and should not be hardcoded into source/seed
  // data. Pull it from an env var (owner-configured, optional) instead of a literal.
  await db.insert(users).values({
    openId: PUBLIC_WORKSPACE_OPEN_ID,
    name: "Shayan Salimi",
    email: process.env.OWNER_EMAIL ?? null,
    loginMethod: "public-workspace",
    role: "admin",
    lastSignedIn: new Date(),
  });
  const createdOwner = await getUserByOpenId(PUBLIC_WORKSPACE_OPEN_ID);
  if (!createdOwner)
    throw new Error("The public workspace owner could not be created");
  return createdOwner.id;
}

export async function ensurePublicWorkspaceInitialized() {
  if (!publicWorkspaceBootstrap) {
    publicWorkspaceBootstrap = (async () => {
      const userId = await getPublicWorkspaceUserId();
      await ensureDashboardSetup(userId);
      const db = await getDb();
      if (!db) throw new Error("The public workspace database is unavailable");
      const activeJob = (
        await db
          .select({ id: jobs.id })
          .from(jobs)
          .where(eq(jobs.status, "active"))
          .limit(1)
      )[0];
      if (!activeJob) {
        const [{ importVerifiedListingBatch }, { PUBLIC_VERIFIED_LISTINGS }] =
          await Promise.all([
            import("./verifiedListingImport"),
            import("./publicVerifiedListings"),
          ]);
        await importVerifiedListingBatch(userId, PUBLIC_VERIFIED_LISTINGS);
      }
      return userId;
    })().catch(error => {
      publicWorkspaceBootstrap = null;
      throw error;
    });
  }
  return publicWorkspaceBootstrap;
}

const defaultTitles = [
  "Construction Project Manager",
  "Project Coordinator Construction",
  "Construction Coordinator",
  "Project Coordinator",
  "Estimator",
  "Junior Estimator",
  "Assistant Estimator",
  "Preconstruction Coordinator",
  "Preconstruction Manager",
  "Assistant Project Manager Construction",
  "Site Superintendent",
];

const profileSkills = {
  projectManagement: [
    "MS Project",
    "multi-site scheduling",
    "budget tracking",
    "resource allocation",
    "change-order management",
  ],
  technical: [
    "AutoCAD",
    "drawing review",
    "scope documentation",
    "permit coordination",
  ],
  construction: [
    "Ontario Building Code knowledge",
    "site inspection",
    "quality control",
    "deficiency management",
    "safety compliance",
  ],
  coordination: [
    "subcontractor management",
    "trade scheduling",
    "contract negotiation",
    "client communication",
  ],
};

const profileExperience = [
  {
    employer: "Cullinan Construction",
    title: "Construction Project Manager",
    period: "Jan 2024 – Present",
    evidence: [
      "permit-to-occupancy delivery",
      "scope, budget, and schedule management",
      "drawing review",
      "municipal approvals",
      "OBC compliance",
      "client communication",
      "change-order and deficiency management",
    ],
  },
  {
    employer: "PMP Homes Inc.",
    title: "Construction Project Manager & Site Superintendent",
    period: "Jun 2021 – Dec 2024",
    evidence: [
      "6–10 luxury residential projects",
      "projects up to $15M",
      "up to five concurrent sites",
      "pre-construction planning",
      "subcontractor procurement",
      "municipal inspections",
      "custom-finish quality control",
    ],
  },
];

const profileEducation = [
  {
    degree: "Master of Science, Architecture",
    institution: "Okan University",
    year: 2019,
  },
  {
    degree: "Bachelor of Science, Civil Engineering",
    institution: "Okan University",
    year: 2016,
  },
];

export async function ensureDashboardSetup(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const [profile, settings] = await Promise.all([
    db
      .select()
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, userId))
      .limit(1),
    db
      .select()
      .from(searchSettings)
      .where(eq(searchSettings.userId, userId))
      .limit(1),
  ]);

  if (!profile[0]) {
    await db.insert(candidateProfiles).values({
      userId,
      displayName: "Shayan Salimi",
      headline: "Construction Project Manager",
      location: "Toronto, Ontario",
      summary:
        "Construction Project Manager with 5+ years directing luxury residential new builds and high-end renovations across the GTA, with verified experience in multi-site delivery, OBC compliance, municipal approvals, trade scheduling, and high-specification quality control.",
      skills: profileSkills,
      experience: profileExperience,
      education: profileEducation,
      scoringGuardrails: [
        "Do not infer professional licensure.",
        "Do not infer work authorization.",
        "Do not assume certifications that are absent from the resume.",
        "Flag material commercial, industrial, high-rise, or credential gaps.",
      ],
      resumeLabel: "Shayan Salimi — ATS Resume",
    });
  }
  if (!settings[0]) {
    await db.insert(searchSettings).values({
      userId,
      targetTitles: defaultTitles,
      employmentTypes: ["full-time"],
      city: "Toronto, Ontario",
      radiusKm: 75,
      minimumScore: 60,
      shortlistLimit: 20,
      timezone: "America/Toronto",
      scheduledTime: "07:30",
      dailyNotificationEnabled: true,
    });
  }
  const existingSources = await db
    .select()
    .from(sourceConfigs)
    .where(eq(sourceConfigs.userId, userId))
    .limit(1);
  if (!existingSources[0]) {
    await db.insert(sourceConfigs).values([
      {
        userId,
        name: "Government of Canada Job Bank",
        kind: "official",
        baseUrl: "https://www.jobbank.gc.ca/",
        enabled: true,
        lastStatus: "Awaiting authorized integration",
      },
      {
        userId,
        name: "Direct employer career pages",
        kind: "employer",
        enabled: true,
        lastStatus: "Ready for approved source configuration",
      },
    ]);
  }
}

export async function getDashboardOverview(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await ensureDashboardSetup(userId);
  const [settings, latestRun, sources] = await Promise.all([
    db
      .select()
      .from(searchSettings)
      .where(eq(searchSettings.userId, userId))
      .limit(1),
    db
      .select()
      .from(jobRuns)
      .where(eq(jobRuns.userId, userId))
      .orderBy(desc(jobRuns.startedAt))
      .limit(1),
    db
      .select()
      .from(sourceConfigs)
      .where(eq(sourceConfigs.userId, userId))
      .orderBy(asc(sourceConfigs.name)),
  ]);
  return { settings: settings[0], latestRun: latestRun[0] ?? null, sources };
}

export async function getProfile(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await ensureDashboardSetup(userId);
  return (
    await db
      .select()
      .from(candidateProfiles)
      .where(eq(candidateProfiles.userId, userId))
      .limit(1)
  )[0];
}

export async function getSettings(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await ensureDashboardSetup(userId);
  const [settings, sources] = await Promise.all([
    db
      .select()
      .from(searchSettings)
      .where(eq(searchSettings.userId, userId))
      .limit(1),
    db
      .select()
      .from(sourceConfigs)
      .where(eq(sourceConfigs.userId, userId))
      .orderBy(asc(sourceConfigs.name)),
  ]);
  return { settings: settings[0], sources };
}

export async function updateSettings(
  userId: number,
  update: Partial<typeof searchSettings.$inferInsert>
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await ensureDashboardSetup(userId);
  await db
    .update(searchSettings)
    .set(update)
    .where(eq(searchSettings.userId, userId));
  return getSettings(userId);
}

export async function updateSourceEnabled(
  userId: number,
  sourceId: number,
  enabled: boolean
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .update(sourceConfigs)
    .set({ enabled })
    .where(
      and(eq(sourceConfigs.userId, userId), eq(sourceConfigs.id, sourceId))
    );
  return getSettings(userId);
}

export async function addSource(
  userId: number,
  input: { name: string; baseUrl?: string; note?: string }
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db.insert(sourceConfigs).values({
    userId,
    name: input.name,
    kind: "manual",
    baseUrl: input.baseUrl,
    enabled: true,
    lastStatus:
      input.note || "Registered manually, awaiting first verified import",
  });
  return getSettings(userId);
}

export async function listShortlist(userId: number, dateKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select({
      entry: shortlistEntries,
      job: jobs,
      scorecard: scorecards,
      action: jobActions,
      application: applications,
    })
    .from(shortlistEntries)
    .innerJoin(jobs, eq(shortlistEntries.jobId, jobs.id))
    .innerJoin(
      scorecards,
      and(eq(scorecards.jobId, jobs.id), eq(scorecards.userId, userId))
    )
    .leftJoin(
      jobActions,
      and(eq(jobActions.jobId, jobs.id), eq(jobActions.userId, userId))
    )
    .leftJoin(
      applications,
      and(eq(applications.jobId, jobs.id), eq(applications.userId, userId))
    )
    .where(
      and(
        eq(shortlistEntries.userId, userId),
        eq(shortlistEntries.dateKey, dateKey)
      )
    )
    .orderBy(asc(shortlistEntries.rank));
}

export async function listJobHistory(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select({
      entry: shortlistEntries,
      job: jobs,
      scorecard: scorecards,
      action: jobActions,
      application: applications,
    })
    .from(shortlistEntries)
    .innerJoin(jobs, eq(shortlistEntries.jobId, jobs.id))
    .innerJoin(
      scorecards,
      and(eq(scorecards.jobId, jobs.id), eq(scorecards.userId, userId))
    )
    .leftJoin(
      jobActions,
      and(eq(jobActions.jobId, jobs.id), eq(jobActions.userId, userId))
    )
    .leftJoin(
      applications,
      and(eq(applications.jobId, jobs.id), eq(applications.userId, userId))
    )
    .where(eq(shortlistEntries.userId, userId))
    .orderBy(desc(shortlistEntries.dateKey), asc(shortlistEntries.rank))
    .limit(100);
}

export async function listRuns(userId: number) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  return db
    .select()
    .from(jobRuns)
    .where(eq(jobRuns.userId, userId))
    .orderBy(desc(jobRuns.startedAt))
    .limit(30);
}

export async function updateProfile(
  userId: number,
  update: { headline: string; location: string; summary: string }
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await ensureDashboardSetup(userId);
  await db
    .update(candidateProfiles)
    .set(update)
    .where(eq(candidateProfiles.userId, userId));
  return getProfile(userId);
}

export async function setJobAction(
  userId: number,
  jobId: number,
  status:
    | "none"
    | "saved"
    | "opened"
    | "applied"
    | "not_interested"
    | "reported_stale"
) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(jobActions)
    .values({ userId, jobId, status })
    .onDuplicateKeyUpdate({ set: { status } });
}
