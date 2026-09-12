# Cross-Source Job Dedup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the same real job is discovered via more than one source (Adzuna, Greenhouse, Indeed) in one day's
run, collapse it to a single listing before it's imported, instead of showing the user the same job twice.

**Architecture:** A new `crossSourceDedup.ts` module (employer-name grouping → batched LLM comparison within each
group → "most complete listing wins" merge), and a restructuring of `runJobSearchForUser` from "collect-then-
import per source" to "collect all three sources, dedup, then import each source's (possibly smaller) list."

**Tech Stack:** `invokeLLM` (`server/_core/llm.ts`) with a `json_schema` response format, same pattern as
`resumeParsing.ts`/`documentTailoring.ts`.

**Design doc:** `docs/superpowers/specs/2026-09-12-indeed-apify-discovery-design.md` ("cross-source dedup"
sections)

**Depends on:** `docs/superpowers/plans/2026-09-12-indeed-apify-discovery.md` must be implemented first — this
plan modifies the same `runJobSearchForUser` function that plan adds an Indeed block to.

**Accepted tradeoff, confirmed 2026-09-12 (see spec):** the "most complete listing wins" rule can drop a
Greenhouse-sourced duplicate (the only source with a tested D2 auto-submit path) in favor of a fuller
non-Greenhouse description. This plan does not special-case Greenhouse — implementing that rule uniformly as
designed.

---

### Task 1: `normalizeEmployerName` and the placeholder guard

**Files:**
- Create: `server/jobSearch/crossSourceDedup.ts`
- Test: `server/jobSearch/crossSourceDedup.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `server/jobSearch/crossSourceDedup.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { normalizeEmployerName } from "./crossSourceDedup";

describe("normalizeEmployerName", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmployerName("  Acme Corp  ")).toBe("acme");
  });

  it("strips common legal suffixes", () => {
    expect(normalizeEmployerName("Acme Inc.")).toBe("acme");
    expect(normalizeEmployerName("Acme LLC")).toBe("acme");
    expect(normalizeEmployerName("Acme Ltd")).toBe("acme");
    expect(normalizeEmployerName("Acme Corp")).toBe("acme");
    expect(normalizeEmployerName("Acme Co")).toBe("acme");
  });

  it("strips punctuation", () => {
    expect(normalizeEmployerName("Acme, Inc.")).toBe("acme");
  });

  it("returns an empty string for placeholder employer values, distinguishing them from a real empty name", () => {
    expect(normalizeEmployerName("Employer not disclosed")).toBe("");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run server/jobSearch/crossSourceDedup.test.ts`
Expected: FAIL — `Cannot find module './crossSourceDedup'`

- [ ] **Step 3: Write the implementation**

Create `server/jobSearch/crossSourceDedup.ts`:

```typescript
import type { VerifiedListing } from "../verifiedListingImport";

const LEGAL_SUFFIX_PATTERN = /\b(inc|llc|ltd|corp|co)\b\.?/gi;
const PUNCTUATION_PATTERN = /[.,]/g;

/**
 * Normalizes an employer name for cross-source dedup grouping: lowercase,
 * trimmed, common legal suffixes and punctuation stripped. Placeholder
 * values ("Employer not disclosed", emitted by both Adzuna and Indeed when a
 * company name is missing) normalize to an empty string specifically so
 * groupByEmployer can exclude them — grouping on the placeholder itself
 * would otherwise bucket unrelated jobs from different real employers into
 * one false dedup candidate group.
 */
export function normalizeEmployerName(name: string): string {
  if (name.trim().toLowerCase() === "employer not disclosed") return "";
  return name
    .toLowerCase()
    .replace(PUNCTUATION_PATTERN, "")
    .replace(LEGAL_SUFFIX_PATTERN, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Groups listings by normalized employer name. Listings with no usable
 * employer name (placeholder or blank, see normalizeEmployerName) are
 * excluded entirely — never treated as a dedup candidate group of their own.
 */
export function groupByEmployer(listings: VerifiedListing[]): Map<string, VerifiedListing[]> {
  const groups = new Map<string, VerifiedListing[]>();
  for (const listing of listings) {
    const key = normalizeEmployerName(listing.employer);
    if (!key) continue;
    const existing = groups.get(key);
    if (existing) existing.push(listing);
    else groups.set(key, [listing]);
  }
  return groups;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run server/jobSearch/crossSourceDedup.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add server/jobSearch/crossSourceDedup.ts server/jobSearch/crossSourceDedup.test.ts
git commit -m "Add employer-name normalization and grouping for cross-source dedup"
```

---

### Task 2: `groupByEmployer` cross-source filtering + `pickMostComplete`

**Files:**
- Modify: `server/jobSearch/crossSourceDedup.ts`
- Modify: `server/jobSearch/crossSourceDedup.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/jobSearch/crossSourceDedup.test.ts`:

```typescript
import { pickMostComplete, groupByEmployer as _groupByEmployer } from "./crossSourceDedup";

function listing(overrides: Partial<import("../verifiedListingImport").VerifiedListing> = {}) {
  return {
    sourceName: "Adzuna",
    sourceExternalId: "1",
    sourcePostingUrl: "https://example.com/1",
    originalApplyUrl: "https://example.com/1",
    title: "Backend Engineer",
    employer: "Acme Corp",
    location: "Toronto, Ontario",
    employmentType: "full-time" as const,
    description: "A".repeat(100),
    postedAt: new Date("2026-09-01"),
    seniorityMatch: "partial" as const,
    verificationNote: "test",
    ...overrides,
  };
}

describe("groupByEmployer (cross-source only)", () => {
  it("only groups employers that have listings from more than one source", () => {
    const groups = groupByEmployer([
      listing({ sourceName: "Adzuna", employer: "Acme" }),
      listing({ sourceName: "Indeed", employer: "Acme" }),
      listing({ sourceName: "Adzuna", employer: "Widgets Inc" }),
    ]);
    expect(groups.get("acme")).toHaveLength(2);
    expect(groups.get("widgets")).toHaveLength(1);
  });
});

describe("pickMostComplete", () => {
  it("prefers the listing with fewer placeholder fields", () => {
    const sparse = listing({ location: "Location not disclosed", description: "A".repeat(90) });
    const full = listing({ location: "Toronto, Ontario", description: "A".repeat(400) });
    expect(pickMostComplete([sparse, full])).toBe(full);
  });

  it("returns the only listing when the group has one", () => {
    const only = listing();
    expect(pickMostComplete([only])).toBe(only);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run server/jobSearch/crossSourceDedup.test.ts`
Expected: FAIL — `pickMostComplete` is not exported; `groupByEmployer` still returns single-source groups (the
"only groups employers with more than one source" test fails since `widgets` shouldn't currently be filtered out
by source-count, only by having a real employer name — this test asserts current behavior already holds for
the employer-name filter, but the group must NOT yet be restricted by source-count until Step 3).

- [ ] **Step 3: Update `groupByEmployer` to only return cross-source groups, and add `pickMostComplete`**

In `server/jobSearch/crossSourceDedup.ts`, replace the `groupByEmployer` function:

```typescript
/**
 * Groups listings by normalized employer name, keeping only groups that
 * contain listings from more than one sourceName — a single-source group
 * can't be a cross-source duplicate, so there's nothing to dedup or compare.
 * Listings with no usable employer name (placeholder or blank, see
 * normalizeEmployerName) are excluded entirely.
 */
export function groupByEmployer(listings: VerifiedListing[]): Map<string, VerifiedListing[]> {
  const allGroups = new Map<string, VerifiedListing[]>();
  for (const listing of listings) {
    const key = normalizeEmployerName(listing.employer);
    if (!key) continue;
    const existing = allGroups.get(key);
    if (existing) existing.push(listing);
    else allGroups.set(key, [listing]);
  }

  const crossSourceGroups = new Map<string, VerifiedListing[]>();
  for (const [key, group] of allGroups) {
    const sources = new Set(group.map(listing => listing.sourceName));
    if (sources.size > 1) crossSourceGroups.set(key, group);
  }
  return crossSourceGroups;
}

const PLACEHOLDER_VALUES = new Set(["Employer not disclosed", "Location not disclosed"]);

function completenessScore(listing: VerifiedListing): number {
  let score = 0;
  if (!PLACEHOLDER_VALUES.has(listing.employer)) score += 1;
  if (!PLACEHOLDER_VALUES.has(listing.location)) score += 1;
  score += listing.description.length;
  if (listing.expiresAt) score += 1;
  return score;
}

/**
 * Picks the single "most complete" listing from a group of cross-source
 * duplicates — whole-listing comparison (fewest placeholder fields, longest
 * description) rather than field-by-field merging. Accepted tradeoff
 * (recorded in the design spec): this can drop a Greenhouse-sourced
 * duplicate — the only source with a tested D2 auto-submit path — in favor
 * of a fuller non-Greenhouse description. Not special-cased here by design.
 */
export function pickMostComplete(group: VerifiedListing[]): VerifiedListing {
  return group.reduce((best, candidate) => (completenessScore(candidate) > completenessScore(best) ? candidate : best));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run server/jobSearch/crossSourceDedup.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add server/jobSearch/crossSourceDedup.ts server/jobSearch/crossSourceDedup.test.ts
git commit -m "Restrict employer grouping to cross-source candidates, add most-complete picker"
```

---

### Task 3: `findDuplicateGroups` (LLM-based comparison)

**Files:**
- Modify: `server/jobSearch/crossSourceDedup.ts`
- Modify: `server/jobSearch/crossSourceDedup.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `server/jobSearch/crossSourceDedup.test.ts`:

```typescript
const invokeLLM = vi.fn();
vi.mock("../_core/llm", () => ({ invokeLLM: (...args: unknown[]) => invokeLLM(...args) }));

import { findDuplicateGroups } from "./crossSourceDedup";

describe("findDuplicateGroups", () => {
  afterEach(() => {
    invokeLLM.mockReset();
  });

  it("returns groups the LLM judges to be the same posting", async () => {
    const a = listing({ sourceName: "Adzuna", sourceExternalId: "a1", title: "Backend Engineer", employer: "Acme" });
    const b = listing({ sourceName: "Indeed", sourceExternalId: "b1", title: "Backend Software Engineer", employer: "Acme" });
    const c = listing({ sourceName: "Indeed", sourceExternalId: "c1", title: "Frontend Engineer", employer: "Acme" });

    invokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ duplicatePairs: [["a1", "b1"]] }) } }],
    });

    const groups = await findDuplicateGroups(new Map([["acme", [a, b, c]]]));
    expect(groups).toHaveLength(1);
    expect(groups[0].map(listing => listing.sourceExternalId).sort()).toEqual(["a1", "b1"]);
  });

  it("skips a group on LLM failure, logging rather than throwing", async () => {
    const a = listing({ sourceName: "Adzuna", sourceExternalId: "a1", employer: "Acme" });
    const b = listing({ sourceName: "Indeed", sourceExternalId: "b1", employer: "Acme" });
    invokeLLM.mockRejectedValueOnce(new Error("OpenRouter timeout"));

    const groups = await findDuplicateGroups(new Map([["acme", [a, b]]]));
    expect(groups).toEqual([]);
  });

  it("returns no groups when there are no employer groups to compare", async () => {
    const groups = await findDuplicateGroups(new Map());
    expect(groups).toEqual([]);
    expect(invokeLLM).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run server/jobSearch/crossSourceDedup.test.ts`
Expected: FAIL — `findDuplicateGroups` is not exported.

- [ ] **Step 3: Write the implementation**

Add to `server/jobSearch/crossSourceDedup.ts` (new imports at the top, function at the bottom):

```typescript
import { invokeLLM } from "../_core/llm";
```

```typescript
const DUPLICATE_PAIRS_SCHEMA = {
  name: "duplicate_job_pairs",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["duplicatePairs"],
    properties: {
      duplicatePairs: {
        type: "array",
        description: "Pairs of listing IDs (from the candidates list) that describe the same real job posting.",
        items: {
          type: "array",
          items: { type: "string" },
          minItems: 2,
          maxItems: 2,
        },
      },
    },
  },
};

function candidateId(listing: VerifiedListing): string {
  return listing.sourceExternalId ?? listing.sourcePostingUrl;
}

/**
 * Union-find over candidateId pairs, so "A=B" and "B=C" collapse into one
 * group {A,B,C} even if the LLM reports them as two separate pairs rather
 * than one triple.
 */
function groupPairs(listings: VerifiedListing[], pairs: [string, string][]): VerifiedListing[][] {
  const byId = new Map(listings.map(listing => [candidateId(listing), listing]));
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  for (const [a, b] of pairs) {
    if (byId.has(a) && byId.has(b)) union(a, b);
  }

  const grouped = new Map<string, VerifiedListing[]>();
  for (const listing of listings) {
    const id = candidateId(listing);
    if (!parent.has(id)) continue;
    const root = find(id);
    const existing = grouped.get(root);
    if (existing) existing.push(listing);
    else grouped.set(root, [listing]);
  }
  return Array.from(grouped.values()).filter(group => group.length > 1);
}

/**
 * For each employer group with cross-source candidates, one batched LLM call
 * (not one call per pair) asks which candidates describe the same real job
 * posting. Bounds LLM cost to roughly one call per employer-with-overlap,
 * not per pair. A failed call for one group is logged and that group is
 * simply left undeduped (its listings import as-is) — a missed dedup is a
 * minor UX blemish, not worth failing the whole run over.
 */
export async function findDuplicateGroups(employerGroups: Map<string, VerifiedListing[]>): Promise<VerifiedListing[][]> {
  const allGroups: VerifiedListing[][] = [];

  for (const [employerKey, candidates] of employerGroups) {
    const prompt = candidates
      .map(listing => `- id: "${candidateId(listing)}", title: "${listing.title}", description: "${listing.description.slice(0, 500)}"`)
      .join("\n");

    let content: string;
    try {
      const result = await invokeLLM({
        messages: [
          {
            role: "system",
            content:
              "You compare job postings from the same employer across different job boards and identify which ones describe the same real job opening (same role, same team/location — not just the same employer). Return pairs of ids that are the same posting.",
          },
          { role: "user", content: prompt },
        ],
        responseFormat: { type: "json_schema", json_schema: DUPLICATE_PAIRS_SCHEMA },
      });
      const raw = result.choices[0]?.message?.content;
      content = typeof raw === "string" ? raw : "";
      if (!content) throw new Error("empty LLM response");
    } catch (error) {
      console.error(`[crossSourceDedup] duplicate comparison failed for employer group "${employerKey}"`, error);
      continue;
    }

    const parsed = JSON.parse(content) as { duplicatePairs: [string, string][] };
    allGroups.push(...groupPairs(candidates, parsed.duplicatePairs));
  }

  return allGroups;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run server/jobSearch/crossSourceDedup.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add server/jobSearch/crossSourceDedup.ts server/jobSearch/crossSourceDedup.test.ts
git commit -m "Add LLM-based cross-source duplicate detection, batched per employer group"
```

---

### Task 4: Restructure `runJobSearchForUser` to collect-then-dedup-then-import

**Files:**
- Modify: `server/telegramBot/jobSearch.ts`
- Modify: `server/telegramBot/jobSearch.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `server/telegramBot/jobSearch.test.ts` (needs `groupByEmployer`/`findDuplicateGroups`/`pickMostComplete`
importable from the real module — do not mock `crossSourceDedup` itself, so the real dedup logic runs in this
test):

```typescript
const invokeLLM = vi.fn();
vi.mock("../_core/llm", () => ({ invokeLLM: (...args: unknown[]) => invokeLLM(...args) }));

describe("runJobSearchForUser cross-source dedup", () => {
  beforeEach(() => {
    getDb.mockResolvedValue(mockDb());
    listGreenhouseWatches.mockResolvedValue([]);
    importVerifiedListingBatch.mockResolvedValue({ imported: 1, shortlisted: 1, duplicatesMerged: 0 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("drops the duplicate copy before importing when Adzuna and Indeed find the same job", async () => {
    searchAdzunaJobs.mockResolvedValue([
      { id: "a1", title: "Backend Engineer", description: "A".repeat(100), company: { display_name: "Acme" }, location: { display_name: "Toronto" }, contract_time: "full_time", created: "2026-09-01T00:00:00Z", redirect_url: "https://adzuna.com/a1" },
    ]);
    searchIndeedJobs.mockResolvedValue([
      { id: "b1", positionName: "Backend Engineer", description: "A".repeat(300), company: "Acme", location: "Toronto", url: "https://indeed.com/b1", postingDateParsed: "2026-09-01T00:00:00Z" },
    ]);
    invokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ duplicatePairs: [["a1", "b1"]] }) } }],
    });

    await runJobSearchForUser(1);

    const importedSourceNames = importVerifiedListingBatch.mock.calls.map(call => call[1][0]?.sourceName);
    // Adzuna's list should have been emptied by dedup (Indeed's longer description won pickMostComplete),
    // so only Indeed's block actually imports anything for this employer.
    expect(importedSourceNames.filter(Boolean)).toEqual(["Indeed"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run server/telegramBot/jobSearch.test.ts`
Expected: FAIL — both Adzuna's and Indeed's blocks currently import immediately and independently, so both
`sourceName`s appear (no dedup has happened yet).

- [ ] **Step 3: Restructure `runJobSearchForUser`**

Replace the whole function body in `server/telegramBot/jobSearch.ts` (keep the same imports, add
`crossSourceDedup`'s three functions):

```typescript
import { findDuplicateGroups, groupByEmployer, pickMostComplete } from "../jobSearch/crossSourceDedup";
```

```typescript
export async function runJobSearchForUser(userId: number): Promise<JobSearchOutcome> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  const settings = (await db.select().from(searchSettings).where(eq(searchSettings.userId, userId)).limit(1))[0];
  if (!settings) return { ok: false, reason: "no_settings" };

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

  const watches = await listGreenhouseWatches(userId);
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

  // Greenhouse imports per-watch (each watch's sourceName is unique,
  // "Greenhouse:<token>"), same as before restructuring — just now using the
  // post-dedup filtered list.
  const greenhouseByWatch = new Map<string, VerifiedListing[]>();
  for (const listing of greenhouseListings) {
    if (toDrop.has(listing)) continue;
    const existing = greenhouseByWatch.get(listing.sourceName);
    if (existing) existing.push(listing);
    else greenhouseByWatch.set(listing.sourceName, [listing]);
  }
  for (const [sourceName, listings] of greenhouseByWatch) {
    if (listings.length === 0) continue;
    anySourceRan = true;
    const result = await importVerifiedListingBatch(userId, listings);
    imported += result.imported;
    shortlisted = result.shortlisted;
    duplicatesMerged += result.duplicatesMerged;
  }

  if (!anySourceRan) {
    return isAdzunaConfigured() || isApifyConfigured() || watches.length > 0
      ? { ok: false, reason: "no_results" }
      : { ok: false, reason: "not_configured" };
  }

  return { ok: true, imported, shortlisted, duplicatesMerged };
}
```

Note: `ensureSourceEnabled` for Adzuna/Indeed now only runs if that source actually has post-dedup listings to
import (matches Greenhouse's existing per-watch behavior, which already only registers on non-empty results) —
a small, deliberate behavior change from before this task (previously Adzuna registered its source config even
on a zero-result run). This is more consistent, not a regression: a source with nothing to import this run
still gets (re-)enabled the next time it does produce results, same as Greenhouse always has.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run server/telegramBot/jobSearch.test.ts`
Expected: PASS (all tests from Task 5 of the Indeed plan, plus this task's new test)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `pnpm check && pnpm test`
Expected: both PASS, no regressions elsewhere (`generalWork.ts`/`scheduler.ts` don't call
`runJobSearchForUser` directly with assumptions about its internals beyond the `JobSearchOutcome` return shape,
which is unchanged).

- [ ] **Step 6: Commit**

```bash
git add server/telegramBot/jobSearch.ts server/telegramBot/jobSearch.test.ts
git commit -m "Restructure runJobSearchForUser to dedup across sources before importing any of them"
```

---

### Task 5: Update the roadmap

**Files:**
- Modify: `docs/telegram-agent/ROADMAP.md`

- [ ] **Step 1: Add a Phase 17 entry**

Append after Phase 16's section:

```markdown
## Phase 17 — Cross-source job dedup ✅ built

Closes Phase 16's known gap: the same real job discovered via more than one source (Adzuna, Greenhouse, Indeed)
in one day's run no longer shows up twice. See
`docs/superpowers/specs/2026-09-12-indeed-apify-discovery-design.md` for the full design.

- [x] `server/jobSearch/crossSourceDedup.ts` — employer-name normalization/grouping (placeholder-employer values
  excluded from grouping), batched per-employer-group LLM comparison, "most complete listing wins" merge.
- [x] `runJobSearchForUser` (`server/telegramBot/jobSearch.ts`) restructured to collect all three sources'
  candidates before any of them import, so duplicates can be dropped pre-import.
- [x] **Accepted, documented tradeoff:** "most complete" can drop a Greenhouse-sourced duplicate (the only source
  with a tested D2 auto-submit path) in favor of a fuller non-Greenhouse description. Not special-cased —
  revisit if this turns out to matter in practice.
- [x] Scoped to same-day dedup only — not against jobs imported on previous days (a materially bigger,
  ongoing-cost feature; explicit non-goal, see the design spec).
- [x] `pnpm check`/`test` clean.

**Not yet live-tested** against a real Railway deployment with real cross-source duplicate jobs.
```

- [ ] **Step 2: Commit**

```bash
git add docs/telegram-agent/ROADMAP.md
git commit -m "Mark Phase 17 (cross-source job dedup) built in ROADMAP.md"
```

---

### Task 6: Live-verify against Railway (manual, not automated)

**Files:** none (deployment/manual verification step)

- [ ] **Step 1: Deploy**

```bash
railway up --service web --ci
```

- [ ] **Step 2: Trigger a real search for a user likely to surface a cross-source duplicate**

Best candidate: a user with both broad target titles (hits Adzuna and Indeed) and a `/watch`ed company that also
posts to Adzuna/Indeed under its own name. Trigger their search, then check Railway logs for
`[crossSourceDedup]` errors (should be none) and confirm in the `jobs` table that no two rows share an
near-identical title+employer+description from different `sourceName`s for that run.

- [ ] **Step 3: Update ROADMAP.md's Phase 17 entry**

Change `**Not yet live-tested**...` to a dated confirmation once a real duplicate has been observed collapsing
correctly.

- [ ] **Step 4: Commit**

```bash
git add docs/telegram-agent/ROADMAP.md
git commit -m "Record live verification of cross-source dedup on Railway"
```
