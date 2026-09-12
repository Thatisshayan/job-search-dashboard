# Indeed discovery via Apify, plus cross-source dedup — Design

**Status:** Approved for planning (brainstormed 2026-09-12)
**Decision basis:** [DECISIONS.md](../../telegram-agent/DECISIONS.md) D1 update (2026-09-12) — Apify approved as a third
discovery source, scoped to Indeed only (not LinkedIn).

## Context

Today `runJobSearchForUser` (`server/telegramBot/jobSearch.ts`) queries two discovery sources per user, each
self-contained:

- **Adzuna** (`server/jobSearch/adzuna.ts`) — broad title/location search, runs automatically for every user against
  their `targetTitles`/`city`/`radiusKm` settings.
- **Greenhouse board API** (`server/jobSearch/greenhouseBoard.ts`) — narrow, per-company, opt-in via `/watch`.

Both map their raw results into the shared `VerifiedListing` shape and import through
`importVerifiedListingBatch`, which requires every listing in one call to share the same `sourceName`.

This spec adds a third source (Indeed, via an Apify actor) with the same "runs automatically for every user"
treatment as Adzuna, and adds a cross-source dedup pass so the same real job posted to more than one source
doesn't show up twice in a user's shortlist.

## Goals

1. Add Indeed as a discovery source, using Apify's actor platform, running automatically in every user's daily
   search alongside Adzuna.
2. Dedup the same job when it appears via more than one source in a single day's run.

## Non-goals (explicit)

- **LinkedIn.** D1's update scoped Apify to Indeed only — LinkedIn is the named defendant in the *hiQ Labs*
  precedent D1 already cites and carries the most aggressive enforcement of the boards considered.
- **Cross-day dedup.** This spec dedupes within one day's run (this run's Adzuna list vs. Greenhouse list vs.
  Indeed list, before any of them import) — not against jobs already imported on previous days. Cross-day dedup
  would mean LLM-comparing every new listing against a growing history table, a materially bigger, ongoing-cost
  feature. Revisit separately if it becomes a real problem in practice.
- **A generic multi-actor abstraction.** `apifyClient.ts` (see below) is generic enough to reuse if a second Apify
  actor is ever added, but nothing here builds speculative support for actors beyond Indeed.
- **Choosing the actor up front.** Deferred to implementation — see "Actor selection," below.

## Architecture

### New modules

**`server/jobSearch/apifyClient.ts`** — generic Apify run/poll/fetch client, independent of what the actor does:

- `runApifyActor<T>(actorId: string, input: unknown): Promise<T[]>` — starts a run (`POST
  /v2/acts/{actorId}/runs`), polls `GET /v2/actor-runs/{runId}` until a terminal status
  (`SUCCEEDED`/`FAILED`/`TIMED-OUT`/`ABORTED`), then fetches `GET /v2/datasets/{defaultDatasetId}/items`.
- Polling has a **5-minute hard cap** as a dead-man's-switch against Apify hanging indefinitely — not a "skip
  Indeed for today" policy (per the earlier decision to let runs complete rather than skip on slowness), just a
  safety net so one stuck run can't block a user's daily notification forever. On cap, throws, caught the same
  way a failed Adzuna title-search is caught today (logged, that title's Indeed results skipped, other sources
  and titles proceed).
- Auth via `APIFY_API_TOKEN` (new env var, added to `server/_core/env.ts` next to `adzunaAppId`/`adzunaAppKey`).

**`server/jobSearch/indeedApify.ts`** — Indeed-specific, same shape as `adzuna.ts`:

- `INDEED_SOURCE_NAME = "Indeed"`
- `isApifyConfigured()` — gates the whole block off when `APIFY_API_TOKEN` is unset, exactly like
  `isAdzunaConfigured()`. Safe to merge before Railway's env var exists.
- `searchIndeedJobs(input: { what: string; where: string; distanceKm: number }): Promise<IndeedJobRaw[]>` — calls
  `runApifyActor` with the chosen actor's ID and input schema, **capped to 20 results** (matching Adzuna's
  `.slice(0, 20)` per-title cap in `jobSearch.ts` today) — Apify bills per run/result, so this is a real cost
  control, not just parity for its own sake.
- `indeedJobToVerifiedListing(job: IndeedJobRaw): VerifiedListing | null` — maps to the shared shape, following
  the same conservative-defaults pattern as `adzunaJobToVerifiedListing` (`seniorityMatch: "partial"`, reject
  listings with no description or too-short description, etc. — exact field thresholds TBD against the actor's
  real output during implementation).

### New module: cross-source dedup

**`server/jobSearch/crossSourceDedup.ts`**:

- `normalizeEmployerName(name: string): string` — lowercase, trim, strip common legal suffixes (Inc, LLC, Ltd,
  Corp, Co, and punctuation).
- `groupByEmployer(listings: VerifiedListing[]): Map<string, VerifiedListing[]>` — deterministic pre-filter; only
  employer groups with listings from more than one `sourceName` are candidates for the next step. This bounds the
  LLM-comparison step to realistic volume instead of comparing every listing against every other listing.
  **Guard:** listings whose `employer` is a placeholder value (`"Employer not disclosed"`, emitted by both Adzuna
  and Indeed when a company name is missing) are excluded from grouping entirely — normalizing that placeholder
  would otherwise bucket unrelated jobs from different real employers into one false dedup candidate group.
- `findDuplicateGroups(candidates: VerifiedListing[]): Promise<VerifiedListing[][]>` — for each employer group with
  cross-source candidates, **one batched LLM call per group** (not one call per pair) sends the candidate
  title/description pairs and asks which are the same posting. Returns groups of listings judged to be the same
  job. Wrapped through the existing `invokeLLM` (`server/_core/llm.ts`), thin enough to mock in tests.
- `pickMostComplete(group: VerifiedListing[]): VerifiedListing` — within a matched group, keeps the listing with
  the fewest placeholder fields (`"Employer not disclosed"`, `"Location not disclosed"`, empty/short description,
  missing `postedAt`) — whole-listing "most complete" rather than field-by-field merging, per the earlier
  decision.

  **Accepted tradeoff, confirmed explicitly (2026-09-12):** this can pick a non-Greenhouse duplicate over a
  Greenhouse-sourced one purely because it has a fuller description, even though Greenhouse is the only source
  with a tested auto-submit path (D2). A job dropped this way loses its D2 auto-submit eligibility for that run.
  Considered and rejected: always preferring the Greenhouse copy regardless of completeness — kept "most
  complete" as the simpler, uniform rule instead. If auto-submit-eligible jobs going missing this way turns out
  to matter in practice, revisit by special-casing Greenhouse in `pickMostComplete`.

### Integration into `runJobSearchForUser`

Restructured from "collect-then-import per source" to "collect all three, dedup, then import per source":

1. Run Adzuna's per-title search loop as today, but **stop before calling `importVerifiedListingBatch`** — just
   collect the deduped-within-source `VerifiedListing[]`.
2. Run Greenhouse's per-watch loop the same way — collect, don't import yet.
3. Run Indeed's per-title search loop the same way (mirrors Adzuna's loop structure).
4. Concatenate all three lists, run `groupByEmployer` → `findDuplicateGroups` → for each duplicate group, replace
   its members with just `pickMostComplete(group)`'s pick in whichever source-list it originally belonged to
   (dropping it from the others).
5. Call `importVerifiedListingBatch` once per source, same as today, each now with its (possibly smaller,
   post-dedup) list. `sourceConfigs`/`ensureSourceEnabled` calls stay exactly where they are today.

This keeps `importVerifiedListingBatch`'s single-`sourceName`-per-call invariant untouched — dedup is a pre-import
filtering pass across in-memory lists, not a change to the import function itself.

## Data flow (end to end)

User's daily run → Adzuna search (per target title) + Greenhouse search (per `/watch`) + Indeed search (per target
title, via Apify) all collect `VerifiedListing[]` in memory → cross-source dedup pass narrows each list → three
`importVerifiedListingBatch` calls (one per source) → existing scoring/shortlist pipeline, unchanged.

## Error handling

- Per-title Indeed failure (actor error, timeout): logged, `continue` to the next title — matches Adzuna's
  existing per-title try/catch. One bad title doesn't kill the run.
- Apify run exceeding the 5-minute cap: treated as a failure for that title (see above), not a silent partial
  result.
- Dedup LLM call failure for one employer group: log and skip dedup for that group only (all its listings import
  as-is, undeduped) — a missed dedup is a minor UX blemish (a job shown twice), not worth failing the whole run
  over.

## Testing

- `apifyClient.test.ts` — poll-loop state transitions and dataset fetch, mocked `fetch` (no live Apify calls).
- `indeedApify.test.ts` — field-mapping against fixture data, same fixture-based style as `adzuna.test.ts` /
  `greenhouseBoard.test.ts`.
- `crossSourceDedup.test.ts` — `normalizeEmployerName`/`groupByEmployer` (deterministic, no mocks) and
  `pickMostComplete` (deterministic); `findDuplicateGroups`'s LLM call mocked the same way other `invokeLLM`
  call-sites are tested elsewhere in the codebase.
- `jobSearch.test.ts` (existing file, extended) — the restructured `runJobSearchForUser` collect-then-dedup-then-
  import flow, verifying a same-employer, same-title listing from two mocked sources collapses to one imported
  job.

## Actor selection

Deferred to implementation start: research well-maintained Indeed actors on the Apify store, weighing cost per
run, reliability/maintenance activity, and output shape's fit with the field-mapping above, and propose one before
wiring in `indeedApify.ts`.

## Inherited scaling limitation (not fixed here)

`scheduler.ts`'s `tick()` loops over users with a sequential `for...await` — already documented in its own
comment as "fine for current single-user scope, revisit if this ever needs to survive across multiple server
instances." Adding a per-title, 5-minute-capped Apify wait per user compounds that existing limitation: as more
users onboard, one user's slow Indeed run can delay every user queued behind them in the same tick. Not addressed
by this spec — consistent with D3 (single-user rollout, multi-user is a scoping decision revisited later) — but
worth being aware of before this genuinely scales past one or two users, since the wait-fully choice (rather than
timing out and skipping) makes the compounding worse than Adzuna's fast REST calls ever were.

## Open questions carried into implementation

- Exact placeholder/length thresholds for `indeedJobToVerifiedListing` (mirrors Adzuna's `description.length < 80`
  check, but Indeed's actual field names/shapes depend on the actor chosen).
- Whether the 5-minute Apify poll cap needs to be configurable per-environment (e.g. shorter in CI/tests) — likely
  yes, follow the existing env-var-driven pattern (`ADZUNA_DEFAULT_COUNTRY` etc.).
- Cap the number of candidate pairs (or truncate description length) sent in one `findDuplicateGroups` LLM call
  for an unusually large employer group, so one busy employer can't balloon a single call's token cost.

## Confirmed actor shape (recorded during implementation, 2026-09-12)

**Superseded same day, once a real Apify token became available.** Initially confirmed via
https://apify.com/misceres/indeed-scraper's public store page only (no live call possible without a token) — see
git history for that original note. Once a real token arrived, three candidates were compared with real live test
calls: `misceres/indeed-scraper` (the original pick), `kaix/indeed-scraper`, and `memo23/apify-indeed-cheerio-ppr`
(the latter two suggested by the user from links they found independently).

**Chosen: `kaix/indeed-scraper`.** Won on every axis checked: 6,170 total users / 1,460 monthly (vs. memo23's 809
total / 278 monthly), 99.8%+ recent success rate, cheaper pay-per-event pricing (from $0.05/1,000 jobs, vs.
memo23's ~$1.49/1,000 results), a real per-job `id` field (misceres had none, forcing a URL fallback for
`sourceExternalId`), and a genuine direct `apply.url` rather than a tracking redirect. Live-tested end-to-end
through the actual `apifyClient.ts`/`indeedApify.ts` code (not just the raw API): a real search for "Backend
Engineer" in "Toronto, ON" returned 20 real listings, all correctly mapped to `VerifiedListing`.

**Confirmed real input schema:** `keyword` (not `position`), `location`, `country` (uppercase 2-letter code, e.g.
`"CA"` — confirmed by a live 201 response; `misceres`'s guessed schema used lowercase), `maxItems` (0 = unlimited,
never pass 0 here since this actor bills per result).

**Confirmed real output schema (nested, unlike misceres' flat guess):** `id` (real, stable), `title.text`,
`company.name`, `location.formatted`, `description.text` (also `description.html` available, unused),
`apply.url` (also mirrored at `urls.apply`), `dates.posted`. Verified directly against live data, not documentation.
