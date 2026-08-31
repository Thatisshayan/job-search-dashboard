# Roadmap / Todo

Scope locked in by [DECISIONS.md](./DECISIONS.md): Telegram-native interface,
OpenRouter for AI, legitimate job-search APIs (not scraping), human final
click retained (no unsupervised auto-submit), single user for now.

Update this file's checkboxes as work lands. If a phase's actual
implementation diverges from what's written here, update the doc in the
same change — this file should always reflect reality, not the original
guess.

## Phase 1 — Swap the LLM provider to OpenRouter ✅ done and verified

- [x] Add `OPENROUTER_API_KEY` / `OPENROUTER_BASE_URL` to `server/_core/env.ts`
- [x] Point `server/_core/llm.ts`'s `invokeLLM`/`listLLMModels` at OpenRouter instead of Manus's Forge proxy
- [x] Add `DEFAULT_OPENROUTER_MODEL` fallback so every request sends a valid `model` (OpenRouter requires one; the old Forge proxy didn't)
- [x] Document the new env vars in `.env.example` and `README.md`
- [x] Get a real `OPENROUTER_API_KEY` and smoke-test `invokeLLM` end-to-end — confirmed working against `openai/gpt-4o-mini` on 2026-08-31

**Not touched, intentionally:** `server/_core/storageProxy.ts`, `voiceTranscription.ts`,
`notification.ts`, `map.ts`, `heartbeat.ts`, `imageGeneration.ts`, `dataApi.ts` —
these are all separate, currently-unused Manus scaffold utilities. Decoupling
them from Manus is a different, not-yet-scoped effort, not part of the AI
provider swap.

### How to verify Phase 1

```bash
export OPENROUTER_API_KEY=sk-or-...
node -e "
import('./server/_core/llm.ts').then(async ({ invokeLLM }) => {
  const result = await invokeLLM({ messages: [{ role: 'user', content: 'Say OK.' }] });
  console.log(result.choices[0].message.content);
});
"
```
(Adjust for how you run TS locally — e.g. via `tsx -e`.) A successful run
means the OpenRouter swap works; nothing in the app calls this yet, so this
is purely a plumbing check.

## Phase 2 — Telegram becomes the app ✅ done and verified (except real Telegram send/download calls — no bot token available in this environment)

- [x] Conversation state machine decided and documented: `awaiting_resume` → `awaiting_target_titles` → `awaiting_location` → `awaiting_radius` → `idle`. Pure transition logic in `server/telegramBot/onboarding.ts` (`planTextStep`), unit-tested in `onboarding.test.ts`.
- [x] New `bot_conversations` table added to `drizzle/schema.ts` (`chatId` unique, `userId`, `state`, `context` JSON) — **migration not yet generated**, see below.
- [x] Chat→user identity resolution: `getOrCreateUserForChat` (`server/telegramBot/db.ts`) creates a `users` row keyed by a synthetic `telegram:<chatId>` openId on first `/start`, independent of the Manus OAuth login the website still uses, and pairs it via the existing `telegramConnections`/`bindTelegramConnection`.
- [x] Extended `telegramWebhook.ts` to route `message` updates (not just `callback_query`) to `server/telegramBot/handler.ts`; added `"message"` to `setTelegramWebhook`'s `allowed_updates` (it only requested `callback_query` before — messages would never have reached the webhook otherwise).
- [x] `/start` command → creates/resets the conversation, sends the welcome + résumé-upload prompt.
- [x] Résumé upload handling: Telegram `document` message → `downloadTelegramFile` (new helper in `server/telegram.ts`, uses `getFile` + the token-embedded file URL) → text extraction via `pdf-parse` (PDF) or `mammoth` (DOCX) → `invokeLLM` with a strict JSON-schema response format → saved to `candidateProfiles`.
  - **Verified live** against the real OpenRouter API with a sample resume — structured extraction and the skills array→`Record<string,string[]>` conversion both work correctly (see `resumeParsing.ts`'s `parseResumeText`).
  - Skills are modeled as `{category, items}[]` rather than a `{[category]: items}` dictionary in the JSON schema — OpenAI-style strict structured outputs don't reliably support open-ended `additionalProperties`; this is converted back to the dictionary shape `candidateProfiles.skills` expects.
- [x] Conversational collection of target roles / location / radius (`planTextStep`), finalizing into `searchSettings` via `saveSearchSettingsFromOnboarding`.

**Verified in this pass** (local MySQL 8 container + real OpenRouter key):
- [x] `pnpm db:generate && pnpm db:migrate` — `drizzle/0003_zippy_swarm.sql` created the `bot_conversations` table cleanly
- [x] Full onboarding data flow exercised directly against a real DB: `getOrCreateUserForChat` → `startConversation` → `saveCandidateProfile` → `planTextStep` through all four states → `saveSearchSettingsFromOnboarding` — all correct
- [x] `pnpm check` / `pnpm test` clean (33 passed, 5 correctly skipped live/integration tests)

**Live end-to-end test completed 2026-08-31** against a real Telegram bot (the
production bot token) and, subsequently, the real deployed app on Railway (see
[DEPLOYMENT.md](./DEPLOYMENT.md)). `/start` → resume upload → role/location/radius
all worked correctly in the actual Telegram client, confirmed against the database
both times. Three real bugs were found and fixed during this test:

1. **`app.set("trust proxy", 1)` was missing** (`server/_core/index.ts`) — every real
   deployment sits behind a reverse proxy (Railway, Vercel, Manus, the cloudflared
   tunnel used for the first pass of this test), and without this Express can't read
   `X-Forwarded-For`, so `express-rate-limit` logged `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`
   on every request. Fixed.
2. **`notifyOwner` was unguarded** in `server/verifiedListingImport.ts` — it throws if
   `BUILT_IN_FORGE_API_URL`/`KEY` (Manus's notification proxy) aren't configured, which
   they intentionally aren't in this deployment. Since this call sits inside the very
   first-request bootstrap path (`ensurePublicWorkspaceInitialized`), it broke *every*
   request until fixed. Now wrapped in try/catch — a missing notification channel must
   never break the shortlist-import path it's attached to.
3. **Résumé education `year` schema issue** — `year: { type: "number" }` under strict
   JSON-schema mode forced the model to invent `0` when a resume doesn't state a
   graduation year. Changed to `type: ["number", "null"]`.

Education year fix aside, this also surfaced a real production migration gap: Railway's
MySQL is only reachable from the private network, and this CLI's SSH implementation
failed host-key verification on Windows even after upgrading, so migrations run as
part of the container's own boot (`"start": "drizzle-kit migrate && node dist/index.js"`
in `package.json`) rather than a separate release step. Revisit if a cleaner CI/CD
release-phase mechanism becomes available.

## Phase 3 — Generalize the candidate profile & scoring ✅ done

- [x] Résumé parsing produces a `candidateProfiles` row (via `invokeLLM` with a JSON-schema response format) instead of the hardcoded seed in `server/db.ts` — landed in Phase 2, confirmed working with a real resume during the live test
- [x] `server/scoring.ts`'s hardcoded `exactTitles`/`relatedTitleTerms` replaced with `matchTitle()`, driven by the caller's `targetTitles` (from `searchSettings`). "Exact" = job title contains a target title; "related" = shares 2+ significant words (stopwords like "senior"/"assistant" excluded) with any single target title.
- [x] Location/commute logic (`isGtaLocation`, hardcoded to ~15 GTA suburb names) replaced with `isWithinTargetRadius()`: prefers a real `locationKm` distance when available, otherwise a coarse city-name-segment text match against `targetCity` (compares only the part before the first comma, so "Ottawa, Ontario" doesn't false-match "Toronto, Ontario" on the shared province name — caught by a test, fixed).
- [x] `verifiedListingImport.ts` and `routers.ts`'s `previewScore` both now pass the caller's real `searchSettings` (`targetTitles`/`city`/`radiusKm`) into `scoreJob` instead of relying on hardcoded defaults.
- [x] `scoring.test.ts` rewritten: proves the engine scores a non-construction role (backend engineer) identically to a construction one, plus explicit tests for the radius-vs-text-fallback precedence and the province-name false-positive fix.

**Known remaining gap, not in this phase's scope:** `findVerifiedSkillMatches` in
`server/verifiedListingImport.ts` still matches resume skills against a hardcoded
construction-specific regex pattern list (`verifiedSkillPatterns`). This means
`resumeSkillMatch` scoring is still construction-biased even though title/location
matching is now generic. Generalizing this properly likely needs an LLM-based
skill-match step (compare the parsed `candidateProfiles.skills` against a job
description) rather than a regex list — worth its own phase/decision rather than a
quick fix bolted onto this one.

## Phase 4 — Real job discovery via legitimate APIs

- [ ] Pick and confirm the specific aggregator API (Adzuna is the leading candidate — confirm free-tier limits are workable before committing)
- [ ] New `server/jobSearch/<provider>.ts` client, producing `VerifiedListing`-shaped output (`server/verifiedListingImport.ts`)
- [ ] Wire it to run against each user's target roles/locations
- [ ] Decide on the "user forwards a link" fallback from `DECISIONS.md` D1 — build now or defer?

## Phase 5 — Score fetched listings automatically

- [ ] Run Phase 4's results through the generalized `scoreJob` (Phase 3) automatically, no manual import step

## Phase 6 — Tailored resume + cover letter per job

- [ ] New `server/documentTailoring.ts`: `invokeLLM` call producing tailored resume bullets + cover letter per scored job
- [ ] Ground generation strictly in parsed résumé facts (extend the existing `scoringGuardrails` no-hallucination pattern from `server/db.ts`)
- [ ] Deliver the tailored materials to the user via Telegram for review

## Phase 7 — Approval stays human-in-the-loop

- [ ] Extend the existing signed-callback approval (`server/telegram.ts`) to cover "approve these tailored materials"
- [ ] Flow still ends at handing the user the original job link for their own manual final click — **do not remove this step** (see `OVERVIEW.md` guardrail / `DECISIONS.md` D2)

## Phase 8 — Daily scheduler

- [ ] Add a real cron/scheduler (evaluate `node-cron` vs. a lightweight interval check) driving discovery → score → tailor → notify once daily per user's `scheduledTime`

## Phase 9 — Retire or shrink the web dashboard

- [ ] Decide: keep `client/` as a thin read-only admin/debug view, or remove it once the bot covers the full loop
- [ ] If removed: decide what (if anything) replaces `server/_core/vite.ts`'s static-serving role

---

## Open questions to resolve before/during the phase they block

- **Phase 4:** exact job-search API and its rate/geographic limits — confirm before writing the client.
- **Phase 6:** which OpenRouter model(s) for parsing vs. tailoring vs. any future routing — `DEFAULT_OPENROUTER_MODEL` is a placeholder, not a final choice.
- **Phase 9:** whether the dashboard has any value once the bot is the primary interface, or if it should just go away.
