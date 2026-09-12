# Indeed Discovery via Apify — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Indeed as a third automatic job-discovery source (alongside Adzuna and Greenhouse), via an Apify actor, running for every user's daily search.

**Architecture:** A generic `apifyClient.ts` (start actor run → poll to terminal status → fetch dataset items) plus an Indeed-specific `indeedApify.ts` (actor ID, input/output mapping to `VerifiedListing`), wired into `runJobSearchForUser` as a third block mirroring the existing Adzuna block.

**Tech Stack:** Node `fetch`, Vitest (`vi.useFakeTimers` for the poll loop), the existing `VerifiedListing`/`importVerifiedListingBatch` pipeline.

**Design doc:** `docs/superpowers/specs/2026-09-12-indeed-apify-discovery-design.md`

**Scope note:** This plan does NOT include cross-source dedup — that's a separate plan
(`docs/superpowers/plans/2026-09-12-cross-source-dedup.md`) that builds on top of this one. Until that plan lands,
the same real job may appear twice (once via Adzuna/Greenhouse, once via Indeed) — an accepted, temporary
tradeoff for shipping this independently.

---

### Task 1: Confirm the Apify actor and its real input/output shape — done during planning review

**Files:**
- Modify: `docs/superpowers/specs/2026-09-12-indeed-apify-discovery-design.md`

Confirmed via the actor's public Apify Store page (`https://apify.com/misceres/indeed-scraper`) before starting
Task 2: still published and actively maintained (30,516 total users, 2,293 monthly users, 99.8% runs succeeded).
No live test call was run (no Apify API token available in this environment) — the public store page's documented
schema is the basis for Tasks 3-4's code. If the real output ever diverges from this once a real token is used in
Task 7's live-verification, fix `indeedApify.ts`'s field mapping then.

**Confirmed input schema:** `position` (string, job keywords/title), `location` (string, city/zip/locality),
`country` (string), `maxItemsPerSearch` (integer, results cap), plus unused-here fields (`startUrls`,
`parseCompanyDetails`, `saveOnlyUniqueItems`).

**Confirmed output fields:** `positionName`, `company`, `location`, `description`/`descriptionHTML`, `url`,
`postedAt`, `salary`, `jobType`, `externalApplyLink`, `rating`/`reviewsCount`. No explicit stable `id` field
documented — `url` is the most reliable stable identifier, so `indeedJobToVerifiedListing` (Task 4) falls back to
`url` when no `id`-like field is present, same defensive pattern as Adzuna's mapper already uses.

This changes two things from the plan's original placeholder code below: the actor input uses `maxItemsPerSearch`
and a required `country` field (not `maxItems`), and the output's date field is `postedAt` (not
`postingDateParsed`) — both already corrected in Tasks 3-4's code below.

- [ ] **Step 1: Record this in the design spec**

Append to `docs/superpowers/specs/2026-09-12-indeed-apify-discovery-design.md`, under a new final section:

```markdown
## Confirmed actor shape (recorded during implementation, 2026-09-12)

Confirmed via https://apify.com/misceres/indeed-scraper's public store page (no live test call — no Apify API
token available in the implementing environment). Still published/maintained: 30,516 total users, 2,293 monthly
users, 99.8% runs succeeded.

**Input:** `position`, `location`, `country`, `maxItemsPerSearch`, plus unused `startUrls`/`parseCompanyDetails`/
`saveOnlyUniqueItems`.

**Output:** `positionName`, `company`, `location`, `description`/`descriptionHTML`, `url`, `postedAt`, `salary`,
`jobType`, `externalApplyLink`, `rating`/`reviewsCount`. No documented stable `id` field — `url` used as the
external-id fallback.

If Task 7's live Railway verification (real API token) finds the actual live output differs from this, fix
`server/jobSearch/indeedApify.ts`'s field mapping then and update this note.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-09-12-indeed-apify-discovery-design.md
git commit -m "Record confirmed Apify Indeed actor input/output shape from its public store page"
```

---

### Task 2: Add `APIFY_API_TOKEN` configuration

**Files:**
- Modify: `server/_core/env.ts`
- Modify: `.env.example`

- [ ] **Step 1: Add the env var to `ENV`**

In `server/_core/env.ts`, add a line after `adzunaAppKey`:

```typescript
  adzunaAppKey: process.env.ADZUNA_APP_KEY ?? "",
  apifyApiToken: process.env.APIFY_API_TOKEN ?? "",
};
```

(Do not add it to `requiredEnvSchema` — like Adzuna, this is optional; its absence just means the source stays
disabled, gated by `isApifyConfigured()` in Task 3.)

- [ ] **Step 2: Document it in `.env.example`**

Find the existing Adzuna block in `.env.example` (the one with `ADZUNA_APP_ID`/`ADZUNA_APP_KEY`) and add after it:

```
# Optional: Apify API token (https://console.apify.com/settings/integrations),
# used to run the Indeed job-discovery actor. Without this, the bot still
# onboards users and searches Adzuna/Greenhouse, but skips Indeed and tells
# them so (same "gracefully skip if unconfigured" pattern as Adzuna above).
APIFY_API_TOKEN=
# Optional: override the dead-man's-switch cap (in ms) on how long a single
# Apify actor run is allowed to poll before this deployment gives up on it.
# Default 300000 (5 minutes).
# APIFY_POLL_CAP_MS=300000
```

- [ ] **Step 3: Commit**

```bash
git add server/_core/env.ts .env.example
git commit -m "Add optional APIFY_API_TOKEN config for the upcoming Indeed discovery source"
```

---

### Task 3: Build the generic Apify run/poll/fetch client

**Files:**
- Create: `server/jobSearch/apifyClient.ts`
- Test: `server/jobSearch/apifyClient.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/jobSearch/apifyClient.test.ts`:

**Correction found during execution:** `ENV` (`server/_core/env.ts`) is a plain object built once at
module-import time from `process.env` — `vi.stubEnv` after import can't retroactively change
`ENV.apifyApiToken`. Mock the `env` module directly instead (below), same fix pattern as any test needing to vary
an `ENV` field per-test.

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({ apifyApiToken: "test-token" }));
vi.mock("../_core/env", () => ({ ENV: mockEnv }));

import { isApifyConfigured, runApifyActor } from "./apifyClient";

describe("isApifyConfigured", () => {
  afterEach(() => {
    mockEnv.apifyApiToken = "test-token";
  });

  it("is false when APIFY_API_TOKEN is unset", () => {
    mockEnv.apifyApiToken = "";
    expect(isApifyConfigured()).toBe(false);
  });
});

describe("runApifyActor", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mockEnv.apifyApiToken = "test-token";
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    fetchMock.mockReset();
  });

  it("starts a run, polls until SUCCEEDED, and returns the dataset items", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "run1", status: "RUNNING", defaultDatasetId: "ds1" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "run1", status: "RUNNING", defaultDatasetId: "ds1" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ title: "Job A" }, { title: "Job B" }],
      });

    const resultPromise = runApifyActor<{ title: string }>("some/actor", { position: "Engineer" });
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await resultPromise;

    expect(result).toEqual([{ title: "Job A" }, { title: "Job B" }]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0][0]).toContain("/acts/some%2Factor/runs");
  });

  it("throws if the run ends in a non-SUCCEEDED terminal status", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "run2", status: "RUNNING", defaultDatasetId: "ds2" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "run2", status: "FAILED", defaultDatasetId: "ds2" } }),
      });

    const resultPromise = runApifyActor("some/actor", {});
    const assertion = expect(resultPromise).rejects.toThrow("ended with status FAILED");
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;
  });

  it("throws if the run does not finish within the poll cap", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "run3", status: "RUNNING", defaultDatasetId: "ds3" } }),
    });

    const resultPromise = runApifyActor("some/actor", {});
    const assertion = expect(resultPromise).rejects.toThrow("did not finish within");
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 3_000);
    await assertion;
  });

  it("throws if APIFY_API_TOKEN is not configured", async () => {
    mockEnv.apifyApiToken = "";
    await expect(runApifyActor("some/actor", {})).rejects.toThrow("APIFY_API_TOKEN is not configured");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run server/jobSearch/apifyClient.test.ts`
Expected: FAIL — `Cannot find module './apifyClient'`

- [ ] **Step 3: Write the implementation**

Create `server/jobSearch/apifyClient.ts`:

```typescript
import { ENV } from "../_core/env";

const APIFY_BASE_URL = "https://api.apify.com/v2";
const POLL_INTERVAL_MS = 3_000;
/**
 * Resolves the design spec's open question ("should the poll cap be
 * configurable?") — yes, via an env var, same pattern as
 * ADZUNA_DEFAULT_COUNTRY. Not needed for test speed (apifyClient.test.ts
 * uses vi.useFakeTimers, so the real duration never elapses in CI), but
 * still useful for tuning in production without a code change.
 */
const MAX_POLL_MS = Number(process.env.APIFY_POLL_CAP_MS) || 5 * 60 * 1000;

type ApifyRunStatus = "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED-OUT" | "ABORTED";

const TERMINAL_STATUSES = new Set<ApifyRunStatus>(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);

type ApifyRunResponse = {
  data: {
    id: string;
    status: ApifyRunStatus;
    defaultDatasetId: string;
  };
};

export function isApifyConfigured(): boolean {
  return Boolean(ENV.apifyApiToken);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readJson<T>(response: Response, action: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${action} failed: ${response.status} ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

/**
 * Starts an Apify actor run with the given input, polls until it reaches a
 * terminal status, then fetches the run's dataset items. Apify runs are
 * asynchronous (unlike Adzuna's single-request REST call) — this is a
 * generic run/poll/fetch client, independent of what any specific actor
 * does. The 5-minute poll cap is a dead-man's-switch against Apify hanging
 * indefinitely, not a "skip this source" policy — see
 * docs/superpowers/specs/2026-09-12-indeed-apify-discovery-design.md.
 */
export async function runApifyActor<T>(actorId: string, input: unknown): Promise<T[]> {
  if (!isApifyConfigured()) {
    throw new Error("APIFY_API_TOKEN is not configured");
  }

  const token = encodeURIComponent(ENV.apifyApiToken);
  const startResponse = await fetch(`${APIFY_BASE_URL}/acts/${encodeURIComponent(actorId)}/runs?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  let run = (await readJson<ApifyRunResponse>(startResponse, "Apify actor start")).data;

  const deadline = Date.now() + MAX_POLL_MS;
  while (!TERMINAL_STATUSES.has(run.status)) {
    if (Date.now() > deadline) {
      throw new Error(`Apify actor run ${run.id} did not finish within ${MAX_POLL_MS / 1000}s`);
    }
    await sleep(POLL_INTERVAL_MS);
    const pollResponse = await fetch(`${APIFY_BASE_URL}/actor-runs/${run.id}?token=${token}`);
    run = (await readJson<ApifyRunResponse>(pollResponse, "Apify run poll")).data;
  }

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify actor run ${run.id} ended with status ${run.status}`);
  }

  const itemsResponse = await fetch(`${APIFY_BASE_URL}/datasets/${run.defaultDatasetId}/items?token=${token}`);
  return readJson<T[]>(itemsResponse, "Apify dataset fetch");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run server/jobSearch/apifyClient.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/jobSearch/apifyClient.ts server/jobSearch/apifyClient.test.ts
git commit -m "Add generic Apify actor run/poll/fetch client"
```

---

### Task 4: Build `indeedApify.ts` (Indeed-specific mapping)

**Files:**
- Create: `server/jobSearch/indeedApify.ts`
- Test: `server/jobSearch/indeedApify.test.ts`

Adjust the field names below (`positionName`, `company`, `location`, `description`, `url`, `postingDateParsed`) if
Task 1's real sample output used different names.

- [ ] **Step 1: Write the failing tests**

Create `server/jobSearch/indeedApify.test.ts` (mirrors `adzuna.test.ts`'s style):

```typescript
import { describe, expect, it } from "vitest";
import { indeedJobToVerifiedListing, INDEED_SOURCE_NAME } from "./indeedApify";

const baseJob = {
  positionName: "Backend Software Engineer",
  description: "A".repeat(120),
  company: "Acme Corp",
  location: "Montreal, Quebec",
  url: "https://www.indeed.com/viewjob?jk=abc123",
  postedAt: "2026-09-01T12:00:00Z",
};

describe("indeedJobToVerifiedListing", () => {
  it("maps a real-shaped Indeed job into a verified listing", () => {
    const listing = indeedJobToVerifiedListing(baseJob);
    expect(listing).not.toBeNull();
    expect(listing?.sourceName).toBe(INDEED_SOURCE_NAME);
    // No documented stable `id` field on this actor's output — `url` is the external-id fallback.
    expect(listing?.sourceExternalId).toBe(baseJob.url);
    expect(listing?.originalApplyUrl).toBe(baseJob.url);
    expect(listing?.employmentType).toBe("full-time");
    expect(listing?.seniorityMatch).toBe("partial");
  });

  it("rejects listings with no title or apply URL", () => {
    expect(indeedJobToVerifiedListing({ ...baseJob, positionName: "" })).toBeNull();
    expect(indeedJobToVerifiedListing({ ...baseJob, url: "" })).toBeNull();
  });

  it("rejects listings with too little description", () => {
    expect(indeedJobToVerifiedListing({ ...baseJob, description: "Too short" })).toBeNull();
  });

  it("falls back to placeholder text for missing company/location", () => {
    const listing = indeedJobToVerifiedListing({ ...baseJob, company: undefined, location: undefined });
    expect(listing?.employer).toBe("Employer not disclosed");
    expect(listing?.location).toBe("Location not disclosed");
  });

  it("falls back to the current date when postedAt is missing", () => {
    const listing = indeedJobToVerifiedListing({ ...baseJob, postedAt: undefined });
    expect(listing?.postedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run server/jobSearch/indeedApify.test.ts`
Expected: FAIL — `Cannot find module './indeedApify'`

- [ ] **Step 3: Write the implementation**

Create `server/jobSearch/indeedApify.ts`:

```typescript
import type { VerifiedListing } from "../verifiedListingImport";
import { isApifyConfigured, runApifyActor } from "./apifyClient";

export { isApifyConfigured };

export const INDEED_SOURCE_NAME = "Indeed";

/**
 * Chosen during implementation research (see docs/superpowers/specs/
 * 2026-09-12-indeed-apify-discovery-design.md, "Confirmed actor shape").
 * Kept as a named constant so swapping actors is a one-line change.
 */
const INDEED_ACTOR_ID = "misceres/indeed-scraper";

const RESULTS_PER_TITLE_CAP = 20;

/**
 * Same single-fixed-country reasoning as Adzuna's ADZUNA_DEFAULT_COUNTRY
 * (server/jobSearch/adzuna.ts) — no per-user country field yet, only a
 * free-text city, so one fixed value covers the whole deployment. Reuses the
 * same env var rather than introducing a second one, since both sources
 * share the same underlying limitation.
 */
const DEFAULT_COUNTRY = process.env.ADZUNA_DEFAULT_COUNTRY || "ca";

type IndeedJobRaw = {
  positionName?: string;
  company?: string;
  location?: string;
  description?: string;
  url?: string;
  postedAt?: string;
};

/**
 * misceres/indeed-scraper's confirmed input schema (see design spec's
 * "Confirmed actor shape" section): position/location/country strings,
 * maxItemsPerSearch caps results (Apify bills per run/result).
 */
export async function searchIndeedJobs(input: { what: string; where: string; distanceKm: number }): Promise<IndeedJobRaw[]> {
  const items = await runApifyActor<IndeedJobRaw>(INDEED_ACTOR_ID, {
    position: input.what,
    location: input.where,
    country: DEFAULT_COUNTRY,
    maxItemsPerSearch: RESULTS_PER_TITLE_CAP,
  });
  return items.slice(0, RESULTS_PER_TITLE_CAP);
}

/**
 * Maps an Apify Indeed actor result into the shape importVerifiedListingBatch
 * expects. Same conservative-defaults pattern as adzunaJobToVerifiedListing:
 * seniorityMatch defaults to "partial" (no per-job LLM comparison against the
 * résumé at this stage), placeholder text for missing employer/location
 * rather than guessing. No documented stable `id` field on this actor's
 * output (see design spec) — `url` doubles as the external id, same as
 * sourcePostingUrl/originalApplyUrl.
 */
export function indeedJobToVerifiedListing(job: IndeedJobRaw): VerifiedListing | null {
  if (!job.positionName || !job.url) return null;
  if (!job.description || job.description.trim().length < 80) return null;

  const postedAt = job.postedAt ? new Date(job.postedAt) : new Date();

  return {
    sourceName: INDEED_SOURCE_NAME,
    sourceExternalId: job.url,
    sourcePostingUrl: job.url,
    originalApplyUrl: job.url,
    title: job.positionName,
    employer: job.company || "Employer not disclosed",
    location: job.location || "Location not disclosed",
    employmentType: "full-time",
    description: job.description,
    postedAt: Number.isNaN(postedAt.getTime()) ? new Date() : postedAt,
    seniorityMatch: "partial",
    verificationNote: "Retrieved automatically via an Apify Indeed actor (see DECISIONS.md D1's 2026-09-12 update).",
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run server/jobSearch/indeedApify.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add server/jobSearch/indeedApify.ts server/jobSearch/indeedApify.test.ts
git commit -m "Add Indeed discovery source (via Apify) with field-mapping tests"
```

---

### Task 5: Wire Indeed into `runJobSearchForUser`

**Files:**
- Modify: `server/telegramBot/jobSearch.ts:1-9,35-59` (add a third source block)
- Test: `server/telegramBot/jobSearch.test.ts` (new file)

- [ ] **Step 1: Write the failing test**

Create `server/telegramBot/jobSearch.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const searchAdzunaJobs = vi.fn();
const searchIndeedJobs = vi.fn();
const searchGreenhouseBoardJobs = vi.fn();
const importVerifiedListingBatch = vi.fn();
const ensureSourceEnabled = vi.fn();
const listGreenhouseWatches = vi.fn();
const getDb = vi.fn();

vi.mock("../jobSearch/adzuna", async () => {
  const actual = await vi.importActual<typeof import("../jobSearch/adzuna")>("../jobSearch/adzuna");
  return { ...actual, searchAdzunaJobs: (...args: unknown[]) => searchAdzunaJobs(...args), isAdzunaConfigured: () => true };
});
vi.mock("../jobSearch/indeedApify", async () => {
  const actual = await vi.importActual<typeof import("../jobSearch/indeedApify")>("../jobSearch/indeedApify");
  return { ...actual, searchIndeedJobs: (...args: unknown[]) => searchIndeedJobs(...args), isApifyConfigured: () => true };
});
vi.mock("../jobSearch/greenhouseBoard", async () => {
  const actual = await vi.importActual<typeof import("../jobSearch/greenhouseBoard")>("../jobSearch/greenhouseBoard");
  return { ...actual, searchGreenhouseBoardJobs: (...args: unknown[]) => searchGreenhouseBoardJobs(...args) };
});
vi.mock("./db", () => ({
  ensureSourceEnabled: (...args: unknown[]) => ensureSourceEnabled(...args),
  listGreenhouseWatches: (...args: unknown[]) => listGreenhouseWatches(...args),
}));
vi.mock("../db", () => ({ getDb: () => getDb() }));
vi.mock("../verifiedListingImport", () => ({
  importVerifiedListingBatch: (...args: unknown[]) => importVerifiedListingBatch(...args),
}));

import { runJobSearchForUser } from "./jobSearch";

const settingsRow = { userId: 1, targetTitles: ["Backend Engineer"], city: "Toronto", radiusKm: 25 };

function mockDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [settingsRow],
        }),
      }),
    }),
  };
}

describe("runJobSearchForUser", () => {
  beforeEach(() => {
    getDb.mockResolvedValue(mockDb());
    listGreenhouseWatches.mockResolvedValue([]);
    importVerifiedListingBatch.mockResolvedValue({ imported: 1, shortlisted: 1, duplicatesMerged: 0 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("imports Indeed results alongside Adzuna's", async () => {
    searchAdzunaJobs.mockResolvedValue([]);
    searchIndeedJobs.mockResolvedValue([
      {
        id: "1",
        positionName: "Backend Engineer",
        company: "Acme",
        location: "Toronto",
        description: "A".repeat(100),
        url: "https://indeed.com/1",
        postingDateParsed: "2026-09-01T00:00:00Z",
      },
    ]);

    const result = await runJobSearchForUser(1);
    expect(result.ok).toBe(true);
    expect(ensureSourceEnabled).toHaveBeenCalledWith(1, "Indeed");
    expect(importVerifiedListingBatch).toHaveBeenCalledWith(
      1,
      expect.arrayContaining([expect.objectContaining({ sourceName: "Indeed", title: "Backend Engineer" })])
    );
  });

  it("continues past an Indeed search failure for one title without failing the whole run", async () => {
    searchAdzunaJobs.mockResolvedValue([]);
    searchIndeedJobs.mockRejectedValue(new Error("Apify actor start failed: 500"));

    const result = await runJobSearchForUser(1);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("no_results");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run server/telegramBot/jobSearch.test.ts`
Expected: FAIL — Indeed is never called (module not wired in yet), so `ensureSourceEnabled` is never called with
`"Indeed"`.

- [ ] **Step 3: Add the Indeed block to `runJobSearchForUser`**

In `server/telegramBot/jobSearch.ts`, add the import (after the existing Greenhouse import on line 7):

```typescript
import { INDEED_SOURCE_NAME, indeedJobToVerifiedListing, isApifyConfigured, searchIndeedJobs } from "../jobSearch/indeedApify";
```

Then insert a new block after the existing Adzuna block (after the closing `}` that follows line 59, before the
`const watches = await listGreenhouseWatches(userId);` line):

```typescript
  if (isApifyConfigured()) {
    await ensureSourceEnabled(userId, INDEED_SOURCE_NAME);
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
    const listings = Array.from(seen.values()).slice(0, 20);
    if (listings.length > 0) {
      anySourceRan = true;
      const result = await importVerifiedListingBatch(userId, listings);
      imported += result.imported;
      shortlisted = result.shortlisted;
      duplicatesMerged += result.duplicatesMerged;
    }
  }
```

Update the final `no_results`/`not_configured` check to also consider Indeed:

```typescript
  if (!anySourceRan) {
    return isAdzunaConfigured() || isApifyConfigured() || watches.length > 0
      ? { ok: false, reason: "no_results" }
      : { ok: false, reason: "not_configured" };
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run server/telegramBot/jobSearch.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Run the full test suite and typecheck**

Run: `pnpm check && pnpm test`
Expected: both PASS, no regressions in `adzuna.test.ts`, `greenhouseBoard.test.ts`, or any other existing test.

- [ ] **Step 6: Commit**

```bash
git add server/telegramBot/jobSearch.ts server/telegramBot/jobSearch.test.ts
git commit -m "Wire Indeed (via Apify) into the daily job search as a third discovery source"
```

---

### Task 6: Update the roadmap

**Files:**
- Modify: `docs/telegram-agent/ROADMAP.md`

- [ ] **Step 1: Add a Phase 16 entry**

Append after Phase 15's section (before Phase 9's, which is the deliberately-out-of-order retrospective section at
the end of the file):

```markdown
## Phase 16 — Indeed discovery via Apify ✅ built

Third automatic discovery source, alongside Adzuna (broad search) and Greenhouse (per-company opt-in). Runs
automatically for every user's daily search, same as Adzuna. See DECISIONS.md D1's 2026-09-12 update (Apify
approved, scoped to Indeed only — not LinkedIn) and
`docs/superpowers/specs/2026-09-12-indeed-apify-discovery-design.md` for the full design.

- [x] `server/jobSearch/apifyClient.ts` — generic Apify actor run/poll/fetch client (5-minute poll cap as a
  dead-man's-switch, not a "skip this source" policy).
- [x] `server/jobSearch/indeedApify.ts` — Indeed-specific search + field-mapping, capped at 20 results per title
  (Apify bills per run/result).
- [x] Wired into `runJobSearchForUser` (`server/telegramBot/jobSearch.ts`) as a third source block, structurally
  identical to the Adzuna block.
- [x] `pnpm check`/`test` clean.

**Known gap, addressed in the next phase:** the same real job can appear via both Indeed and Adzuna/Greenhouse —
no cross-source dedup yet. See Phase 17.

**Not yet live-tested** against a real Railway deployment with a real Apify token.
```

- [ ] **Step 2: Commit**

```bash
git add docs/telegram-agent/ROADMAP.md
git commit -m "Mark Phase 16 (Indeed discovery via Apify) built in ROADMAP.md"
```

---

### Task 7: Live-verify against Railway (manual, not automated)

**Files:** none (deployment/manual verification step)

- [ ] **Step 1: Set `APIFY_API_TOKEN` on Railway**

```bash
railway variable set APIFY_API_TOKEN=<the real token> --service web
```

- [ ] **Step 2: Deploy**

```bash
railway up --service web --ci
```

- [ ] **Step 3: Trigger a real search and confirm Indeed results appear**

Use the bot's on-demand search trigger (or wait for the daily scheduler) for a real onboarded user, then check the
Railway logs for `[jobSearch]` lines and confirm no `Indeed search failed` errors, and that at least one shortlist
entry has `sourceName: "Indeed"` (query the `jobs` table via `railway connect MySQL` or a quick `drizzle-kit
studio` session against the production `DATABASE_URL`).

- [ ] **Step 4: Update ROADMAP.md's Phase 16 entry**

Change `**Not yet live-tested**...` to a dated confirmation, e.g. `**Live-verified 2026-09-13** against the real
Railway deployment — a real Indeed listing reached a user's shortlist.`

- [ ] **Step 5: Commit**

```bash
git add docs/telegram-agent/ROADMAP.md
git commit -m "Record live verification of Indeed discovery on Railway"
```
