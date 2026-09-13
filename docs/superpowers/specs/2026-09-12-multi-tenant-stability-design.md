# Multi-tenant stability hardening — Design

**Status:** Approved for planning (brainstormed 2026-09-12)
**Trigger:** General hardening pass before wider rollout, not a specific incident. D3 in
[DECISIONS.md](../../telegram-agent/DECISIONS.md) explicitly deferred multi-user rollout, noting it "can be
revisited once the single-user flow is proven reliable" — this is that revisit.

## Context

An audit (see conversation history 2026-09-12) checked the codebase for concrete multi-tenant correctness risks
across 8 areas: data isolation, scheduler correctness, shared external API contention, Telegram identity/webhook
handling, onboarding races, cross-user cost fairness, Greenhouse-watch isolation, and multi-user test coverage.

**Confirmed solid, no action needed:** data isolation itself (every scoped query filters by the correct `userId`;
unique indexes exist where they matter) and per-user resource scoping (a `/watch` registered by one user cannot
collide with another's, since `sourceConfigs` reads/writes always filter by `userId` too).

**Real gaps found, in priority order:**

1. **[Blocking] `scheduler.ts`'s `tick()` has no overlap guard.** Fires every 60s via `setInterval`
   (`scheduler.ts:66-71`) with no check that the previous tick finished. `tick()` sequentially awaits every
   enabled user's full search (`scheduler.ts:38-63`); Indeed's Apify actor alone can poll up to 5 minutes per
   title (`apifyClient.ts`'s `MAX_POLL_MS`). With as few as 2-3 users, a tick can run past 60s, so a second tick
   starts mid-loop. Both ticks then race on the same users: `alreadyRanToday` (`scheduler.ts:23-29`) only checks
   for an existing `jobRuns` row for today, and — since Phase 17's restructuring made `runJobSearchForUser`
   collect all three sources' candidates *before* any import call — the window before the first `jobRuns` row for
   a run even exists is now **wider than before that refactor**, not narrower. This is a live-data-proven risk,
   not a theoretical one.

2. **[Worth-hardening] `sourceConfigs` has no unique constraint on `(userId, name)`** (`schema.ts:74-90` — only a
   plain index on `userId`). `ensureSourceEnabled`/`registerGreenhouseWatch` (`telegramBot/db.ts`) do a
   read-then-insert with no DB-level guard, so the exact race Finding 1 would trigger can create duplicate rows
   for one user. Does not leak across users, but compounds Finding 1's damage for the affected user.

3. **[Worth-hardening] `getOrCreateUserForChat`'s read-then-insert has a TOCTOU race** (`telegramBot/db.ts:25-39`).
   Protected by a real `.unique()` constraint on `users.openId` (`schema.ts:16`), so a genuine race fails loudly
   with a DB error rather than silently splitting one person into two users — not a data-integrity leak, but an
   unhandled-error path with no retry/catch for that specific conflict.

4. **[Worth-hardening] No serialization on concurrent Telegram webhook deliveries for the same chat.**
   `telegramWebhook.ts`/`handler.ts`'s onboarding-step functions read a conversation's `state`, then act on it,
   with no lock — a double-tap or Telegram's own retry could race two onboarding-step handlers for one chat.
   Self-contained to the affected user, not a cross-user leak.

5. **[Worth-hardening, lower priority than initially scoped] Shared external API fairness.** Adzuna, Apify, and
   OpenRouter keys are shared across all users with no per-user budget or backoff coordination, and
   `DEFAULT_OPENROUTER_MODEL` is already pinned to a free-tier model with real rate limits (`llm.ts:228-241`).
   **Re-scoped during design:** since Phase 15 made `scheduledTime` genuinely user-chosen (not a hardcoded
   `"07:30"` default baked into every user), the "thundering herd at one clock time" framing from the initial
   audit overstates it — clustering is plausible if many users pick similar times, but isn't a guaranteed
   collision. More importantly, `tick()` is already sequential (one user's calls complete before the next user's
   start), so there's no *concurrent* burst today — the real exposure is Finding 1's long-running tick, not a
   separate rate-limit problem. Fixing Finding 1 addresses most of this; no separate fix planned here beyond
   that.

6. **[Gap, not a bug] Zero test coverage exercises two `userId`s together.** Isolation has never been asserted by
   a test, only structurally implied by schema. Addressed by adding real multi-user tests, not by changing
   production code.

## Goals

1. Make the scheduler safe against overlapping ticks — a user can never be double-processed by two ticks running
   concurrently, on either the career or general-work track.
2. Make `sourceConfigs` registration race-safe at the database level, not just by application-level read-then-insert.
3. Serialize onboarding-step handling per Telegram chat, so a double-delivered webhook can't race itself.
4. Add multi-user tests that actually assert isolation between two different `userId`s, closing Finding 6.

## Non-goals (explicit)

- **A separate rate-limiter/fairness system for Adzuna/Apify/OpenRouter.** Re-scoped out per Finding 5's
  reasoning above — Finding 1's fix removes the actual exposure; a dedicated fairness system would be solving a
  problem that isn't concretely present yet. Revisit if real usage shows otherwise.
- **`getOrCreateUserForChat`'s unhandled-conflict path (Finding 3).** The existing `.unique()` constraint already
  prevents the actual data-integrity risk (no split-user corruption possible); adding a catch/retry is a minor
  robustness nicety, not a stability requirement — deferred, not fixed here, to keep this plan focused on the two
  findings that actually compound into real risk (1 and 2) plus the one with no existing guard at all (4).
- **Horizontal scaling (multiple Railway instances).** `scheduler.ts`'s own existing comment already flags this
  as out of scope until "this ever needs to survive across multiple server instances" — still true; the fixes
  here (DB-level claim + in-process guard) are what make a *single* instance safe, and are also a real step
  toward eventual multi-instance safety (the DB-level claim, unlike the in-process flag, would still work across
  instances) without fully solving it.

## Architecture

### Fix 1: Scheduler overlap guard (two layers)

**In-process flag** (cheap, handles the common single-instance case immediately): `scheduler.ts` gets a
module-level `let tickInProgress = false`. `tick()` returns immediately if already `true`; sets it `true` at
entry, `false` in a `finally`.

**DB-level claim** (correct even if this ever runs on multiple instances — the in-process flag alone wouldn't
help there): move the `jobRuns` "claim" earlier than it happens today, **for both tracks the scheduler can run**:

- *Career track* (`runJobSearchForUser`): the *first* `jobRuns` row for a run isn't created until
  `importVerifiedListingBatch`'s first call, which itself doesn't happen until *after*
  `runJobSearchForUser` has already collected results from Adzuna, Indeed, and Greenhouse (Phase 17's
  restructuring widened this gap).
- *General-work track* (`runGeneralWorkSearchForUser`): has the identical problem, independently — its `jobRuns`
  insert (`jobSearch.ts`, the comment beginning "This track never touches importVerifiedListingBatch...") happens
  only at the very end, after the search and all `jobs` table writes are done, not as an early claim.

Fix for both: insert a `jobRuns` row with `status: "running"` **before** calling any discovery source (at the top
of `runJobSearchForUser` and `runGeneralWorkSearchForUser` respectively), then update that same row's status at
the end instead of inserting a fresh one. `alreadyRanToday` already checks for *any* row for today regardless of
status — no change needed there, just confirming the earlier insert actually closes the gap for both tracks. If a
second tick's `alreadyRanToday` check runs after the first tick's claim-row insert but before its sources finish,
it now correctly sees "already running today" and skips, for whichever track that user is on.

**Interaction between the two:** the in-process flag prevents 99% of real overlap (same process, same 60s
interval) cheaply; the DB claim is defense-in-depth for the case the in-process flag can't cover (process
restart mid-tick, or a future second instance) and is worth having regardless since it's a small change to an
already-existing insert's timing, not new infrastructure.

### Fix 2: `sourceConfigs` unique constraint + upsert

**Migration:** add `uniqueIndex("source_configs_user_name_unique").on(table.userId, table.name)` to `sourceConfigs`
in `drizzle/schema.ts`, generate the migration with `drizzle-kit generate`.

**Code change:** `ensureSourceEnabled` and `registerGreenhouseWatch` (`telegramBot/db.ts`) switch from
read-then-insert to `db.insert(sourceConfigs).values(...).onDuplicateKeyUpdate({ set: {...} })` — MySQL's native
upsert, atomic at the database level, closing the race regardless of how many ticks/requests hit it concurrently.

### Fix 3: Per-chat webhook serialization

A module-level `Map<string, Promise<void>>` in `telegramWebhook.ts` (or a new small `chatLock.ts`), keyed by
`chatId`. A helper `withChatLock(chatId, fn)` chains onto the existing promise for that chat (or resolves
immediately if none), ensuring only one handler runs at a time per chat, while different chats still process
fully in parallel. Wraps the `handleIncomingMessage`/`advanceOnboardingStep` call sites in `telegramWebhook.ts`.
In-memory only — acceptable at current scale (`scheduler.ts` already documents the same "single in-process"
assumption), and correctly scoped as a per-chat lock, not a global one, so it doesn't serialize unrelated users'
messages against each other.

### Fix 4: Multi-user tests

Extend existing test files (not a new module) with cases that construct two different `userId`s and assert
isolation holds, e.g.:
- `scheduler.test.ts`: two users' settings rows, assert `tick()` only processes the one matching the current
  time/not-already-run, and (once Fix 1 lands) that a simulated overlapping second `tick()` call doesn't
  double-process either user.
- `jobSearch.test.ts`: assert both `runJobSearchForUser` and `runGeneralWorkSearchForUser` insert their claim
  `jobRuns` row before calling any discovery source (mocked), not just at completion.
- A new test for `ensureSourceEnabled`'s upsert behavior: two concurrent calls for the same `(userId, name)`
  produce exactly one row (mocked DB, asserting `onDuplicateKeyUpdate` is used, not a real concurrency test against
  a real DB).
- A new test for the chat-lock helper: two concurrent calls for the same `chatId` execute sequentially; two calls
  for different `chatId`s execute concurrently (both resolve without waiting on each other).

## Testing strategy

Standard Vitest unit/mocked-integration tests, consistent with the rest of this codebase — no real concurrency
(no actual parallel DB connections in CI) is needed to prove these fixes: the overlap guard, the upsert, and the
chat lock are all deterministically testable by directly exercising their logic with mocked timing/DB calls, the
same way `jobSearch.test.ts` already tests `runJobSearchForUser`'s per-source failure handling without a real
network.

## Open questions carried into implementation

- Exact migration file naming/number (next available `NNNN_` prefix in `drizzle/`) — determined at implementation
  time by running `drizzle-kit generate`.
- Whether `tickInProgress`'s reset-on-crash behavior needs anything beyond a `finally` block (e.g., if the whole
  process crashes mid-tick, the flag doesn't matter since it's reset to `false` on restart — no special handling
  needed, but worth confirming this reasoning holds during implementation).
