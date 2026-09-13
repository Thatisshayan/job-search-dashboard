# Multi-Tenant Stability Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the scheduler's overlapping-tick race (a live bug, not a scale concern), make `sourceConfigs`
registration race-safe at the database level, and serialize per-chat webhook handling — the three fixes the
2026-09-12 audit found actually compound into real risk, per the design spec.

**Architecture:** An in-process "tick in progress" flag plus moving each track's `jobRuns` claim row to before any
external API call (not after, as today); a new unique DB constraint plus a native MySQL upsert replacing
`sourceConfigs`' read-then-insert; a small per-chat-keyed promise-chain lock wrapping the Telegram webhook handler.

**Tech Stack:** Existing Drizzle ORM/MySQL, Vitest, Express — no new dependencies.

**Design doc:** `docs/superpowers/specs/2026-09-12-multi-tenant-stability-design.md`

---

### Task 1: Scheduler in-process overlap guard

**Files:**
- Modify: `server/scheduler.ts`
- Test: `server/scheduler.test.ts`

- [ ] **Step 1: Write the failing test**

`server/scheduler.test.ts` currently starts with `import { describe, expect, it } from "vitest";` — change that
line to add the extra imports this task needs:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
```

Then append to the file:

```typescript
const getDb = vi.fn();
vi.mock("./db", () => ({ getDb: () => getDb() }));
vi.mock("./telegramBot/notify", () => ({ runSearchAndNotify: vi.fn() }));
vi.mock("./telegramBot/generalWork", () => ({ runGeneralWorkAndNotify: vi.fn() }));

describe("tick overlap guard", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    getDb.mockReset();
  });

  it("skips a second tick that starts while the first is still running", async () => {
    let resolveSelect: (rows: unknown[]) => void;
    const slowSelect = new Promise<unknown[]>(resolve => {
      resolveSelect = resolve;
    });
    getDb.mockResolvedValue({
      select: () => ({ from: () => slowSelect }),
    });

    const { tick } = await import("./scheduler");
    const first = tick();
    const second = tick(); // fires while `first` is still awaiting the slow settingsRows query

    resolveSelect!([]);
    await first;
    await second;

    // getDb is called exactly once per tick that actually runs its body -- the
    // second, overlapping call should have returned immediately without
    // touching the db at all.
    expect(getDb).toHaveBeenCalledTimes(1);
  });

  it("processes multiple users independently, only running the one whose scheduled time matches", async () => {
    const { searchSettings, telegramConnections } = await import("../drizzle/schema");
    const { runSearchAndNotify } = await import("./telegramBot/notify");

    const matchingUser = { userId: 1, dailyNotificationEnabled: true, timezone: "UTC", scheduledTime: "07:30", track: "career" };
    const nonMatchingUser = { userId: 2, dailyNotificationEnabled: true, timezone: "UTC", scheduledTime: "23:59", track: "career" };

    getDb.mockResolvedValue({
      select: () => ({
        from: (table: unknown) => {
          if (table === searchSettings) return Promise.resolve([matchingUser, nonMatchingUser]);
          if (table === telegramConnections) {
            return { where: () => ({ limit: async () => [{ userId: matchingUser.userId, chatId: "chat-1" }] }) };
          }
          // jobRuns, via alreadyRanToday's db.select().from(jobRuns).where(...).orderBy(...).limit(1)
          return { where: () => ({ orderBy: () => ({ limit: async () => [] }) }) };
        },
      }),
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T07:30:00.000Z"));
    const { tick } = await import("./scheduler");
    await tick();
    vi.useRealTimers();

    expect(runSearchAndNotify).toHaveBeenCalledWith("chat-1", 1);
    expect(runSearchAndNotify).not.toHaveBeenCalledWith(expect.anything(), 2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run server/scheduler.test.ts`
Expected: FAIL — `getDb` is called twice (`tick` isn't exported yet either; fix that first if it errors on the
import, then confirm the call-count assertion is what fails).

Note: `tick` is currently not exported from `scheduler.ts` (it's a private `async function tick()`). Export it as
part of Step 3, since this test (and Task 1's own fix) needs to call it directly.

- [ ] **Step 3: Add the guard and export `tick`**

In `server/scheduler.ts`, add a module-level flag and guard the function, and export it:

```typescript
let tickInProgress = false;

/**
 * Checked once a minute: for every user whose local clock currently reads
 * their configured scheduledTime and who hasn't already had a job run today
 * (in their own timezone), trigger a search and notify their paired Telegram
 * chat. Single in-process interval — fine for the current single-user scope;
 * revisit if this ever needs to survive across multiple server instances.
 *
 * Guarded against overlapping calls: Indeed's Apify actor alone can poll up
 * to 5 minutes per title (apifyClient.ts), so with more than a couple of
 * users a tick can easily run past the 60s interval below. Without this
 * guard, a second tick starting mid-loop would race the first on the same
 * users -- see docs/superpowers/specs/2026-09-12-multi-tenant-stability-
 * design.md, Fix 1.
 */
export async function tick(): Promise<void> {
  if (tickInProgress) return;
  tickInProgress = true;
  try {
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

        if (settings.track === "general") {
          await runGeneralWorkAndNotify(connection.chatId, settings.userId);
        } else {
          await runSearchAndNotify(connection.chatId, settings.userId);
        }
      } catch (error) {
        console.error(`[scheduler] Daily search failed for user ${settings.userId}`, error);
      }
    }
  } finally {
    tickInProgress = false;
  }
}

export function startDailyScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    tick().catch(error => console.error("[scheduler] tick failed", error));
  }, CHECK_INTERVAL_MS);
}
```

(Only the function signature/export and the flag are new — the body inside the `try` is unchanged from today's
`tick()`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run server/scheduler.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and typecheck**

Run: `pnpm check && pnpm test`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add server/scheduler.ts server/scheduler.test.ts
git commit -m "Add in-process overlap guard so a slow scheduler tick can't race a second one"
```

---

### Task 2: Claim the career-track run before any external API call

**Files:**
- Modify: `server/telegramBot/jobSearch.ts`
- Modify: `server/telegramBot/jobSearch.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/telegramBot/jobSearch.test.ts`:

```typescript
describe("runJobSearchForUser claims its jobRuns row early", () => {
  beforeEach(() => {
    getDb.mockResolvedValue(mockDb());
    listGreenhouseWatches.mockResolvedValue([]);
    importVerifiedListingBatch.mockResolvedValue({ imported: 1, shortlisted: 1, duplicatesMerged: 0 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a claim jobRuns row before calling any discovery source", async () => {
    const callOrder: string[] = [];
    const insertMock = vi.fn(() => ({
      values: vi.fn(() => {
        callOrder.push("jobRuns.insert");
        return [{ insertId: 42 }];
      }),
    }));
    getDb.mockResolvedValue({ ...mockDb(), insert: insertMock, update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })) });

    searchAdzunaJobs.mockImplementation(async () => {
      callOrder.push("adzuna.search");
      return [];
    });
    searchIndeedJobs.mockImplementation(async () => {
      callOrder.push("indeed.search");
      return [];
    });

    await runJobSearchForUser(1);

    expect(callOrder[0]).toBe("jobRuns.insert");
    expect(callOrder).toContain("adzuna.search");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run server/telegramBot/jobSearch.test.ts`
Expected: FAIL — no `jobRuns.insert` happens before Adzuna's search today (the only `jobRuns` write currently
happens deep inside the mocked `importVerifiedListingBatch`, which this test doesn't reach since both sources
return empty results — confirming there is currently *no* early claim at all).

- [ ] **Step 3: Add the claim-row insert**

In `server/telegramBot/jobSearch.ts`, add the `jobRuns` import (already imported) and a small local helper, then
restructure the top of `runJobSearchForUser`:

```typescript
function resultHeader(value: unknown) {
  return (Array.isArray(value) ? value[0] : value) as { insertId?: number };
}
```

Replace the function body's opening (from `const adzunaListings` through the `watches`/`greenhouseListings`
setup) with:

```typescript
export async function runJobSearchForUser(userId: number): Promise<JobSearchOutcome> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const settings = (await db.select().from(searchSettings).where(eq(searchSettings.userId, userId)).limit(1))[0];
  if (!settings) return { ok: false, reason: "no_settings" };

  // Fetched before claiming so an unconfigured/no-watches user still gets
  // today's early "not_configured" result with no jobRuns row written --
  // unchanged from today's behavior. Only once we know something will
  // actually run do we claim the row, but that claim now happens BEFORE any
  // slow external search call, not after all three sources finish (see
  // docs/superpowers/specs/2026-09-12-multi-tenant-stability-design.md,
  // Fix 1 -- this closes the scheduler-overlap race for the career track).
  const watches = await listGreenhouseWatches(userId);
  const willRunAnything = isAdzunaConfigured() || isApifyConfigured() || watches.length > 0;
  if (!willRunAnything) return { ok: false, reason: "not_configured" };

  const claimInsert = await db.insert(jobRuns).values({ userId, status: "running" });
  const claimRunId = resultHeader(claimInsert).insertId;

  try {
    const adzunaListings: VerifiedListing[] = [];
    if (isAdzunaConfigured()) {
      const seen = new Map<string, VerifiedListing>();
      for (const title of settings.targetTitles) {
        let results;
        try {
          results = await searchAdzunaJobs({ what: title, where: settings.city, distanceKm: settings.radiusKm, resultsPerPage: 10 });
        } catch (error) {
          console.error(`[jobSearch] Adzuna search failed for title "${title}"`, error);
          continue;
        }
        for (const job of results) {
          const listing = adzunaJobToVerifiedListing(job);
          if (listing) seen.set(`${listing.sourceName}:${listing.sourceExternalId}`, listing);
        }
      }
      adzunaListings.push(...Array.from(seen.values()).slice(0, 20));
    }

    const indeedListings: VerifiedListing[] = [];
    if (isApifyConfigured()) {
      const seen = new Map<string, VerifiedListing>();
      for (const title of settings.targetTitles) {
        let results;
        try {
          results = await searchIndeedJobs({ what: title, where: settings.city, distanceKm: settings.radiusKm });
        } catch (error) {
          console.error(`[jobSearch] Indeed search failed for title "${title}"`, error);
          continue;
        }
        for (const job of results) {
          const listing = indeedJobToVerifiedListing(job);
          if (listing) seen.set(`${listing.sourceName}:${listing.sourceExternalId}`, listing);
        }
      }
      indeedListings.push(...Array.from(seen.values()).slice(0, 20));
    }

    const greenhouseListings: VerifiedListing[] = [];
    for (const watch of watches) {
      const boardToken = watch.name.slice("Greenhouse:".length);
      let jobs;
      try {
        jobs = await searchGreenhouseBoardJobs(boardToken);
      } catch (error) {
        console.error(`[jobSearch] Greenhouse board search failed for "${boardToken}"`, error);
        continue;
      }
      const employer = watch.lastStatus?.match(/^Watching (.+)'s Greenhouse board$/)?.[1] ?? boardToken;
      greenhouseListings.push(
        ...jobs
          .map(job => greenhouseBoardJobToVerifiedListing(job, employer, boardToken))
          .filter((listing): listing is VerifiedListing => listing !== null)
          .slice(0, 30)
      );
    }

    // Cross-source dedup: compare all three sources' candidates before any of
    // them import. A matched group's "most complete" listing is kept in
    // whichever source-list it originally belonged to; the rest are dropped
    // from theirs. See docs/superpowers/specs/2026-09-12-indeed-apify-
    // discovery-design.md for why this runs here, not inside
    // importVerifiedListingBatch (which requires one sourceName per call).
    const allCandidates = [...adzunaListings, ...indeedListings, ...greenhouseListings];
    const duplicateGroups = await findDuplicateGroups(groupByEmployer(allCandidates));
    const toDrop = new Set<VerifiedListing>();
    for (const group of duplicateGroups) {
      const winner = pickMostComplete(group);
      for (const listing of group) {
        if (listing !== winner) toDrop.add(listing);
      }
    }

    const sourceBatches: Array<{ sourceName: string; listings: VerifiedListing[] }> = [
      { sourceName: ADZUNA_SOURCE_NAME, listings: adzunaListings.filter(listing => !toDrop.has(listing)) },
      { sourceName: INDEED_SOURCE_NAME, listings: indeedListings.filter(listing => !toDrop.has(listing)) },
    ];

    let imported = 0;
    let shortlisted = 0;
    let duplicatesMerged = 0;
    let anySourceRan = false;

    for (const batch of sourceBatches) {
      if (batch.listings.length === 0) continue;
      await ensureSourceEnabled(userId, batch.sourceName);
      anySourceRan = true;
      const result = await importVerifiedListingBatch(userId, batch.listings);
      imported += result.imported;
      shortlisted = result.shortlisted;
      duplicatesMerged += result.duplicatesMerged;
    }

    const greenhouseByWatch = new Map<string, VerifiedListing[]>();
    for (const listing of greenhouseListings) {
      if (toDrop.has(listing)) continue;
      const existing = greenhouseByWatch.get(listing.sourceName);
      if (existing) existing.push(listing);
      else greenhouseByWatch.set(listing.sourceName, [listing]);
    }
    for (const listings of Array.from(greenhouseByWatch.values())) {
      if (listings.length === 0) continue;
      anySourceRan = true;
      const result = await importVerifiedListingBatch(userId, listings);
      imported += result.imported;
      shortlisted = result.shortlisted;
      duplicatesMerged += result.duplicatesMerged;
    }

    if (claimRunId) {
      await db
        .update(jobRuns)
        .set({ status: "completed", listingsCollected: imported, shortlistCount: shortlisted, duplicatesMerged, completedAt: new Date() })
        .where(eq(jobRuns.id, claimRunId));
    }

    if (!anySourceRan) return { ok: false, reason: "no_results" };
    return { ok: true, imported, shortlisted, duplicatesMerged };
  } catch (error) {
    if (claimRunId) {
      await db
        .update(jobRuns)
        .set({ status: "failed", errorSummary: error instanceof Error ? error.message : String(error), completedAt: new Date() })
        .where(eq(jobRuns.id, claimRunId));
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run server/telegramBot/jobSearch.test.ts`
Expected: PASS (all tests in the file, including this new one)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `pnpm check && pnpm test`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add server/telegramBot/jobSearch.ts server/telegramBot/jobSearch.test.ts
git commit -m "Claim the career-track daily run before any discovery-source call, not after"
```

---

### Task 3: Claim the general-work-track run before any external API call

**Files:**
- Modify: `server/telegramBot/jobSearch.ts`
- Modify: `server/telegramBot/jobSearch.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/telegramBot/jobSearch.test.ts`:

```typescript
import { runGeneralWorkSearchForUser } from "./jobSearch";

describe("runGeneralWorkSearchForUser claims its jobRuns row early", () => {
  beforeEach(() => {
    listGreenhouseWatches.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a claim jobRuns row before calling Adzuna", async () => {
    const callOrder: string[] = [];
    const dbStub = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [settingsRow] }) }) }),
      insert: vi.fn(() => ({
        values: vi.fn(() => {
          callOrder.push("jobRuns.insert");
          return [{ insertId: 99 }];
        }),
      })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    };
    getDb.mockResolvedValue(dbStub);

    searchAdzunaJobs.mockImplementation(async () => {
      callOrder.push("adzuna.search");
      return [];
    });

    await runGeneralWorkSearchForUser(1);

    expect(callOrder[0]).toBe("jobRuns.insert");
    expect(callOrder).toContain("adzuna.search");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run server/telegramBot/jobSearch.test.ts`
Expected: FAIL — today's `runGeneralWorkSearchForUser` only inserts into `jobRuns` at the very end, after the
Adzuna search and every `jobs` table write, so `callOrder[0]` is `"adzuna.search"`, not `"jobRuns.insert"`.

- [ ] **Step 3: Move the claim earlier**

In `server/telegramBot/jobSearch.ts`, restructure `runGeneralWorkSearchForUser`:

```typescript
export async function runGeneralWorkSearchForUser(userId: number): Promise<GeneralWorkOutcome> {
  if (!isAdzunaConfigured()) return { ok: false, reason: "not_configured" };
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const settings = (await db.select().from(searchSettings).where(eq(searchSettings.userId, userId)).limit(1))[0];
  if (!settings) return { ok: false, reason: "no_settings" };

  await ensureSourceEnabled(userId, GENERAL_WORK_SOURCE_NAME);

  // Claimed before the search loop, not after -- same reasoning as the
  // career-track fix in runJobSearchForUser. See docs/superpowers/specs/
  // 2026-09-12-multi-tenant-stability-design.md, Fix 1.
  const claimInsert = await db.insert(jobRuns).values({ userId, status: "running" });
  const claimRunId = resultHeader(claimInsert).insertId;

  try {
    const seen = new Map<string, VerifiedListing>();
    for (const title of GENERAL_WORK_TITLES) {
      let results;
      try {
        results = await searchAdzunaJobs({ what: title, where: settings.city, distanceKm: settings.radiusKm, resultsPerPage: 5 });
      } catch (error) {
        console.error(`[generalWorkSearch] Adzuna search failed for title "${title}"`, error);
        continue;
      }
      for (const job of results) {
        const listing = adzunaJobToVerifiedListing(job);
        if (listing) seen.set(`${listing.sourceExternalId ?? listing.sourcePostingUrl}`, listing);
      }
    }
    const listings = Array.from(seen.values()).slice(0, GENERAL_WORK_RESULTS_CAP);
    if (listings.length === 0) {
      if (claimRunId) await db.update(jobRuns).set({ status: "completed", completedAt: new Date() }).where(eq(jobRuns.id, claimRunId));
      return { ok: false, reason: "no_results" };
    }

    const jobIds: number[] = [];
    for (const listing of listings) {
      const fingerprint = generalWorkFingerprint(listing);
      await db
        .insert(jobs)
        .values({
          sourceName: GENERAL_WORK_SOURCE_NAME,
          sourcePostingUrl: listing.sourcePostingUrl,
          originalApplyUrl: listing.originalApplyUrl,
          sourceExternalId: listing.sourceExternalId,
          fingerprint,
          title: listing.title,
          employer: listing.employer,
          location: listing.location,
          locationKm: listing.locationKm,
          employmentType: listing.employmentType,
          description: listing.description,
          postedAt: listing.postedAt,
          expiresAt: listing.expiresAt,
          status: "active",
          analysis: { verificationNote: listing.verificationNote, track: "general-work" },
          lastSeenAt: new Date(),
        })
        .onDuplicateKeyUpdate({
          set: { status: "active", lastSeenAt: new Date(), originalApplyUrl: listing.originalApplyUrl },
        });
      const row = (await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.fingerprint, fingerprint)).limit(1))[0];
      if (row) jobIds.push(row.id);
    }
    if (jobIds.length === 0) {
      if (claimRunId) await db.update(jobRuns).set({ status: "completed", completedAt: new Date() }).where(eq(jobRuns.id, claimRunId));
      return { ok: false, reason: "no_results" };
    }

    const existingApplications = await db
      .select({ jobId: applications.jobId, telegramMessageId: applications.telegramMessageId })
      .from(applications)
      .where(and(eq(applications.userId, userId), inArray(applications.jobId, jobIds)));
    const alreadyDecided = new Set(existingApplications.filter(row => row.telegramMessageId).map(row => row.jobId));

    const rows = await db.select().from(jobs).where(inArray(jobs.id, jobIds));
    const newJobs: GeneralWorkJob[] = rows
      .filter(row => !alreadyDecided.has(row.id))
      .map(row => ({ jobId: row.id, title: row.title, employer: row.employer, location: row.location, originalApplyUrl: row.originalApplyUrl }));

    if (claimRunId) {
      await db
        .update(jobRuns)
        .set({ status: "completed", listingsCollected: listings.length, jobsScored: jobIds.length, shortlistCount: newJobs.length, completedAt: new Date() })
        .where(eq(jobRuns.id, claimRunId));
    }

    return { ok: true, found: listings.length, newJobs };
  } catch (error) {
    if (claimRunId) {
      await db
        .update(jobRuns)
        .set({ status: "failed", errorSummary: error instanceof Error ? error.message : String(error), completedAt: new Date() })
        .where(eq(jobRuns.id, claimRunId));
    }
    throw error;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run server/telegramBot/jobSearch.test.ts`
Expected: PASS

- [ ] **Step 5: Run the full suite and typecheck**

Run: `pnpm check && pnpm test`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add server/telegramBot/jobSearch.ts server/telegramBot/jobSearch.test.ts
git commit -m "Claim the general-work-track daily run before any discovery-source call, not after"
```

---

### Task 4: `sourceConfigs` unique constraint + upsert

**Files:**
- Modify: `drizzle/schema.ts`
- Modify: `server/telegramBot/db.ts`
- Create: a new migration (via `drizzle-kit generate`)
- Test: `server/telegramBot/db.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `server/telegramBot/db.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

const insertValues = vi.fn();
const onDuplicateKeyUpdate = vi.fn();
const selectLimit = vi.fn();

vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
    insert: () => ({ values: insertValues }),
  }),
}));

import { ensureSourceEnabled } from "./db";

describe("ensureSourceEnabled", () => {
  it("uses a native upsert (onDuplicateKeyUpdate), not a read-then-insert", async () => {
    insertValues.mockReturnValue({ onDuplicateKeyUpdate });
    onDuplicateKeyUpdate.mockResolvedValue(undefined);

    await ensureSourceEnabled(1, "Adzuna");

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, name: "Adzuna", enabled: true }));
    expect(onDuplicateKeyUpdate).toHaveBeenCalledWith(expect.objectContaining({ set: expect.objectContaining({ enabled: true }) }));
    // No read-then-check step -- the pre-check select from today's
    // implementation should never be called.
    expect(selectLimit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run server/telegramBot/db.test.ts`
Expected: FAIL — today's `ensureSourceEnabled` calls `db.select()...limit()` first (the mocked `selectLimit` gets
called), and never calls `insert().values().onDuplicateKeyUpdate()`.

- [ ] **Step 3: Add the unique constraint to the schema**

In `drizzle/schema.ts`, find the `sourceConfigs` table definition and add a unique index:

```typescript
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
  table => [
    index("source_configs_user_idx").on(table.userId),
    uniqueIndex("source_configs_user_name_unique").on(table.userId, table.name),
  ],
);
```

- [ ] **Step 4: Generate the migration**

`drizzle-kit generate` needs `DATABASE_URL` set to *something* (it only introspects `schema.ts` and the local
`drizzle/meta/` snapshots — no live DB connection is actually made for `generate`), so a placeholder value is
fine if `.env`'s isn't set locally:

Run: `DATABASE_URL="mysql://user:pass@localhost:3306/placeholder" npx drizzle-kit generate`
Expected: a new `drizzle/00XX_<generated-name>.sql` file plus updated `drizzle/meta/_journal.json` and a new
`drizzle/meta/00XX_snapshot.json`. Open the generated `.sql` file and confirm it contains an `ADD UNIQUE INDEX`
(or equivalent `CREATE UNIQUE INDEX`) statement for `source_configs_user_name_unique` — if drizzle-kit instead
generated a *new table* or something unexpected, stop and investigate before proceeding (this usually means the
local `meta/` snapshots are out of sync with the live schema — do not force through it).

- [ ] **Step 5: Switch `ensureSourceEnabled` and `registerGreenhouseWatch` to upserts**

In `server/telegramBot/db.ts`, replace both functions:

```typescript
export async function ensureSourceEnabled(userId: number, sourceName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  await db
    .insert(sourceConfigs)
    .values({ userId, name: sourceName, kind: "licensed", enabled: true, lastStatus: "Auto-registered for bot-driven search" })
    .onDuplicateKeyUpdate({ set: { enabled: true } });
}
```

```typescript
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
  await db.insert(sourceConfigs).values(values).onDuplicateKeyUpdate({ set: values });
}
```

Both now rely on MySQL's native `INSERT ... ON DUPLICATE KEY UPDATE`, atomic against the new unique constraint —
no read-then-insert window for two concurrent calls (e.g. two overlapping scheduler ticks, closed by Task 1, but
this closes it at the database level too, independent of that fix) to race on.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm vitest run server/telegramBot/db.test.ts`
Expected: PASS

- [ ] **Step 7: Run the full suite and typecheck**

Run: `pnpm check && pnpm test`
Expected: both PASS. Also grep for any other caller relying on `ensureSourceEnabled`/`registerGreenhouseWatch`'s
old read-then-insert return behavior (neither function returned a value before or after this change, so this
should be a no-op check): `grep -rn "ensureSourceEnabled\|registerGreenhouseWatch" server/`.

- [ ] **Step 8: Commit**

```bash
git add drizzle/schema.ts drizzle/*.sql drizzle/meta server/telegramBot/db.ts server/telegramBot/db.test.ts
git commit -m "Add unique (userId, name) constraint on sourceConfigs, switch to a native upsert"
```

---

### Task 5: Per-chat webhook serialization

**Files:**
- Create: `server/telegramBot/chatLock.ts`
- Test: `server/telegramBot/chatLock.test.ts`
- Modify: `server/telegramWebhook.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/telegramBot/chatLock.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { withChatLock } from "./chatLock";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("withChatLock", () => {
  it("serializes calls for the same chatId", async () => {
    const order: string[] = [];
    const first = deferred<void>();

    const call1 = withChatLock("chat-1", async () => {
      order.push("call1-start");
      await first.promise;
      order.push("call1-end");
    });
    const call2 = withChatLock("chat-1", async () => {
      order.push("call2-start");
    });

    // call2 must not have started yet -- it's queued behind call1.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["call1-start"]);

    first.resolve();
    await call1;
    await call2;

    expect(order).toEqual(["call1-start", "call1-end", "call2-start"]);
  });

  it("runs calls for different chatIds concurrently", async () => {
    const order: string[] = [];
    const first = deferred<void>();

    const call1 = withChatLock("chat-1", async () => {
      order.push("chat1-start");
      await first.promise;
      order.push("chat1-end");
    });
    const call2 = withChatLock("chat-2", async () => {
      order.push("chat2-start");
    });

    await call2; // chat-2's call completes without waiting on chat-1's lock
    expect(order).toEqual(["chat1-start", "chat2-start"]);

    first.resolve();
    await call1;
  });

  it("a rejected call doesn't block later calls for the same chatId", async () => {
    await expect(
      withChatLock("chat-3", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    const result = await withChatLock("chat-3", async () => "ok");
    expect(result).toBe("ok");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run server/telegramBot/chatLock.test.ts`
Expected: FAIL — `Cannot find module './chatLock'`

- [ ] **Step 3: Write the implementation**

Create `server/telegramBot/chatLock.ts`:

```typescript
const locks = new Map<string, Promise<unknown>>();

/**
 * Serializes handler execution per Telegram chat, so two near-simultaneous
 * webhook deliveries for the same chat (a double-tap, a Telegram retry)
 * can't race each other's onboarding-state reads/writes. Different chats
 * still run fully concurrently -- this is a per-chat lock, not a global one.
 * In-memory only, same "single in-process instance" assumption
 * scheduler.ts already documents -- acceptable at current scale.
 */
export function withChatLock<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(chatId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // Store a variant that never rejects for future chaining, so one call's
  // failure doesn't poison the queue for this chatId's later calls. The
  // real result (including a rejection) is still what `next` -- returned to
  // this call's caller -- resolves/rejects with.
  locks.set(chatId, next.catch(() => undefined));
  return next;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run server/telegramBot/chatLock.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire into the webhook handler**

In `server/telegramWebhook.ts`, add the import and wrap the whole route body (after the secret check) in a
per-chat lock:

```typescript
import { withChatLock } from "./telegramBot/chatLock";
```

```typescript
export function registerTelegramWebhook(app: Express) {
  app.post("/api/telegram/webhook", async (req: Request, res: Response) => {
    if (!isValidTelegramWebhookSecret(req.get("X-Telegram-Bot-Api-Secret-Token"))) {
      res.status(401).json({ ok: false });
      return;
    }

    const chatId = String(req.body?.message?.chat?.id ?? req.body?.callback_query?.message?.chat?.id ?? "");
    const handle = async () => {
      const message = req.body?.message;
      if (message?.chat?.id) {
        try {
          await handleIncomingMessage(message);
        } catch (error) {
          console.error("[TelegramBot] Failed to handle incoming message", error);
        }
        res.status(200).json({ ok: true });
        return;
      }

      const callback = req.body?.callback_query;
      if (!callback?.id || !callback?.data || !callback?.message?.chat?.id) {
        res.status(200).json({ ok: true });
        return;
      }

      const radiusMatch = /^radius:(\d+)$/.exec(String(callback.data));
      if (radiusMatch) {
        const radiusChatId = String(callback.message.chat.id);
        try {
          const conversation = await getConversation(radiusChatId);
          if (conversation?.state === "awaiting_radius") {
            await advanceOnboardingStep(radiusChatId, conversation, radiusMatch[1]);
          }
          await answerTelegramCallback(String(callback.id), `${radiusMatch[1]} km`);
        } catch (error) {
          console.error("[TelegramBot] Failed to handle radius button tap", error);
        }
        res.status(200).json({ ok: true });
        return;
      }

      const onboardingButtonMatch = /^obstep:(track|resume|recurring):(\w+)$/.exec(String(callback.data));
      if (onboardingButtonMatch) {
        const [, step, value] = onboardingButtonMatch;
        const expectedState: Record<string, string> = {
          track: "awaiting_track_choice",
          resume: "awaiting_resume_choice",
          recurring: "awaiting_recurring_choice",
        };
        const stepChatId = String(callback.message.chat.id);
        try {
          const conversation = await getConversation(stepChatId);
          if (conversation?.state === expectedState[step]) {
            await advanceOnboardingStep(stepChatId, conversation, value);
          }
          await answerTelegramCallback(String(callback.id), value);
        } catch (error) {
          console.error("[TelegramBot] Failed to handle onboarding button tap", error);
        }
        res.status(200).json({ ok: true });
        return;
      }

      const finalChatId = String(callback.message.chat.id);
      const data = String(callback.data);

      if (isGreenhouseConfirmCallback(data)) {
        try {
          const outcome = await processGreenhouseConfirmationCallback({ callbackId: String(callback.id), chatId: finalChatId, data });
          await answerTelegramCallback(String(callback.id), outcome.text);
          res.status(200).json({ ok: true });
        } catch {
          res.status(500).json({ ok: false });
        }
        return;
      }

      try {
        const outcome = await processTelegramApprovalCallback({
          callbackId: String(callback.id),
          chatId: finalChatId,
          data,
        });
        await answerTelegramCallback(String(callback.id), outcome.text);
        if (outcome.state !== "ignored" && outcome.telegramMessageId) {
          await markApprovalCardResolved(finalChatId, outcome.telegramMessageId, outcome.text);
        }
        if (outcome.state === "ready_for_final_confirmation" && outcome.originalApplyUrl) {
          let autoApplyStarted = false;
          if (isGreenhouseApplyUrl(outcome.originalApplyUrl)) {
            try {
              const autoApplyResult = await prepareGreenhouseAutoSubmitConfirmation(outcome.userId, outcome.jobId);
              autoApplyStarted = autoApplyResult.ok;
              if (!autoApplyResult.ok) {
                console.error(`[TelegramBot] Greenhouse auto-apply setup declined for job ${outcome.jobId}: ${autoApplyResult.reason}`);
              }
            } catch (error) {
              console.error(`[TelegramBot] Greenhouse auto-apply setup failed for job ${outcome.jobId}`, error);
            }
          }

          if (!autoApplyStarted) {
            try {
              await sendFinalBrowserReviewCard({
                chatId: finalChatId,
                title: outcome.jobTitle,
                employer: outcome.employer,
                originalApplyUrl: outcome.originalApplyUrl,
              });
            } catch (error) {
              console.error("Telegram browser-review follow-up could not be delivered", error);
            }
            await sendTailoredMaterialsForJob(finalChatId, outcome.userId, outcome.jobId);
          }
        }
        res.status(200).json({ ok: true });
      } catch {
        res.status(500).json({ ok: false });
      }
    };

    if (chatId) {
      await withChatLock(chatId, handle);
    } else {
      await handle();
    }
  });
}
```

(This is a mechanical refactor: the existing body is moved into a `handle` closure unchanged except renaming the
inner `chatId`/`data` re-declarations that would otherwise shadow the outer `chatId` — `radiusChatId`,
`stepChatId`, `finalChatId` — and the whole thing is now called through `withChatLock` when a chat is
identifiable, or directly otherwise, e.g. malformed payloads with neither `message` nor `callback_query`.)

- [ ] **Step 6: Run the full suite and typecheck**

Run: `pnpm check && pnpm test`
Expected: both PASS — no existing webhook test should behave differently, since single-request behavior is
unchanged; only concurrent-request ordering for the same chat is now serialized.

- [ ] **Step 7: Commit**

```bash
git add server/telegramBot/chatLock.ts server/telegramBot/chatLock.test.ts server/telegramWebhook.ts
git commit -m "Serialize Telegram webhook handling per chat to close an onboarding-state race"
```

---

### Task 6: Update the roadmap

**Files:**
- Modify: `docs/telegram-agent/ROADMAP.md`

- [ ] **Step 1: Add a Phase 18 entry**

Append after Phase 17's section:

```markdown
## Phase 18 — Multi-tenant stability hardening ✅ built

General hardening pass ahead of wider rollout (not triggered by a specific incident), per D3's note that
multi-user "can be revisited once the single-user flow is proven reliable." A real audit found data isolation
itself already solid everywhere checked; these fixes close the gaps that were real. See
`docs/superpowers/specs/2026-09-12-multi-tenant-stability-design.md` for the full audit and design.

- [x] `scheduler.ts`'s `tick()` now guards against overlapping calls (in-process flag) -- closes a live bug, not
  just a scale concern: Indeed's Apify actor alone can poll up to 5 minutes per title, so a tick could already run
  past its own 60s interval with just a couple of users.
- [x] Both `runJobSearchForUser` (career track) and `runGeneralWorkSearchForUser` (general-work track) now claim
  their `jobRuns` row **before** calling any discovery source, not after all three sources finish -- closes the
  actual race window `alreadyRanToday` depends on. Phase 17's restructuring had made this gap wider for the
  career track, not narrower.
- [x] `sourceConfigs` gained a real `(userId, name)` unique constraint (migration), and
  `ensureSourceEnabled`/`registerGreenhouseWatch` switched from read-then-insert to a native MySQL upsert --
  race-safe at the database level regardless of what triggers concurrent calls.
- [x] Telegram webhook handling is now serialized per chat (`chatLock.ts`) -- a double-tap or Telegram's own
  retry can no longer race two onboarding-step handlers for the same chat. Different chats still process fully
  concurrently.
- [x] Re-scoped out during design: a dedicated fairness/rate-limiting system for the shared Adzuna/Apify/
  OpenRouter API keys -- traced back to the same root cause as the scheduler fix (a long-running sequential tick,
  not a true concurrent burst), so no separate system was built. Revisit if real usage shows otherwise.
- [x] `pnpm check`/`test` clean.

**Confirmed already solid, no changes needed:** per-user data isolation (every scoped query already filters
correctly) and per-user resource scoping (Greenhouse watches, source configs) were already race-free *across*
users -- the gaps found were all within one user's own concurrent-request handling, not cross-user leakage.

**Not yet live-tested** against the real Railway deployment under actual concurrent load.
```

- [ ] **Step 2: Commit**

```bash
git add docs/telegram-agent/ROADMAP.md
git commit -m "Mark Phase 18 (multi-tenant stability hardening) built in ROADMAP.md"
```
