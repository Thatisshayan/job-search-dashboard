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

## Phase 4 — Real job discovery via legitimate APIs ✅ done and verified live

- [x] Confirmed Adzuna: free, no card required, covers Canada (`ca`) and 17 other countries, "hundreds of calls/day" free tier — verified against their docs and public sources, not assumed. See commit for sources.
- [x] `server/jobSearch/adzuna.ts` — `searchAdzunaJobs()` (calls `/v1/api/jobs/{country}/search/1`, `full_time=1` pre-filter) and `adzunaJobToVerifiedListing()` (maps to the exact shape `importVerifiedListingBatch` expects, rejecting part-time/too-short-description/no-URL results before they'd hit that function's own validation).
- [x] `server/telegramBot/jobSearch.ts`'s `runJobSearchForUser()` — queries Adzuna once per configured target title, dedupes by `sourceExternalId` across titles, auto-provisions an "Adzuna" `sourceConfigs` row for the user (there's no website UI for a bot user to do this themselves — see Phase 6/7 note below), then calls the existing `importVerifiedListingBatch`.
- [x] Wired into `server/telegramBot/handler.ts`: the moment onboarding finishes (radius answered), it runs this search immediately and sends the shortlisted jobs back as Telegram cards (`sendOriginalLinkReviewCard`, already existed) — not a "check the dashboard" message, since **the website dashboard is single-tenant** (hardwired to one "public workspace" user) and would show the wrong person's data for any bot-onboarded user. This is a real architectural gap worth its own decision later, not something this phase tries to fix.
- [x] `pnpm check`/`test`/`build` clean, including new unit tests for the pure Adzuna-mapping function (full-time filter, description-length filter, missing-URL rejection, placeholder fallbacks).

**Two honesty notes captured in code comments** (`adzuna.ts`): Adzuna's `redirect_url` is an aggregator-hosted redirect, not literally the employer's own domain (still leads to the real application, standard for aggregators, but not identical to the old hand-picked-link model). And `seniorityMatch` defaults to `"partial"` for every result rather than being judged per listing — there's no per-job LLM comparison against the résumé in this phase, so it's deliberately conservative rather than guessing "strong".

**Live end-to-end test completed 2026-08-31**, on the real Railway deployment, with
a real Adzuna key: `/start` → resume upload → target titles "Construction
Coordinator" etc. → Toronto → radius → the bot searched immediately and sent back
3 real, live construction-coordinator job cards in Toronto. `notifyOwner`'s already-
fixed graceful degradation (Phase 1) fired exactly as designed (logged, not fatal)
since the notification proxy still isn't configured on this deployment — confirmed
in the logs, no other errors.

**Still open:**
- [ ] The "user forwards a link" fallback from `DECISIONS.md` D1 — deferred; Adzuna coverage is confirmed working, so this is lower priority now.
- [ ] Only one fixed country per deployment (`ADZUNA_DEFAULT_COUNTRY`, default `ca`) — there's no per-user country field yet, so a user searching outside that country would get no results silently. Worth adding to onboarding if this becomes a real need.

## Phase 5 — Score fetched listings automatically ✅ done (folded into Phase 4)

`importVerifiedListingBatch` has always scored every listing it imports as part of the same call — there was never a separate "import" step followed by a distinct "scoring" step to build. Phase 4's `runJobSearchForUser` already goes through this exact function, so this phase's original goal was satisfied by Phase 4 rather than needing separate work.

- [ ] Run Phase 4's results through the generalized `scoreJob` (Phase 3) automatically, no manual import step

## Phase 6 — Tailored resume + cover letter per job ✅ done, verified live

- [x] `server/documentTailoring.ts`: `generateTailoredMaterials()` calls `invokeLLM` with a strict JSON-schema response (`resumeHighlights[]`, `coverLetter`, `gapsToMention[]`) to produce tailored materials per scored job.
- [x] Grounded strictly in the candidate's real parsed profile — the system prompt forbids inventing licensure/certifications/experience not in the profile and requires unmet requirements to go in `gapsToMention` rather than being glossed over, extending the same guardrail philosophy already in `server/db.ts`'s seed data and Phase 2's résumé-parsing prompt.
- [x] Wired into `server/telegramBot/handler.ts`'s `runInitialSearch`: right after each shortlisted job's link card, it fetches the candidate profile once and sends tailored materials for that job.
- [x] Verified live against the real OpenRouter API with a realistic profile/job pair: resume highlights and cover letter were accurate, specific to the employer/title, and traced back to real profile facts with no invented claims.
- [x] **Revised after live user feedback**: materials are now delivered as two separate PDF files (a full tailored resume, a cover letter) via Telegram's `sendDocument`, not a single text message. `server/telegram.ts` gained `sendDocumentBuffer()` (multipart upload — the only call in that file that isn't a plain JSON POST). `documentTailoring.ts` was restructured so the LLM only rewrites/selects *bullets per real experience entry* (referenced by index) and picks from the *real* skill list, rather than freely regenerating resume content — every employer name, title, date, and skill in the final PDF traces back to a real field the server controls, not something the model wrote from scratch. Output is validated (invalid experience indexes and hallucinated skills are filtered) before being used to build the PDF, as defense in depth on top of the prompt rules.
- [x] `pnpm check`/`test` (44 passed, including real PDF-buffer generation checks)/`build` all clean.
- [x] **Live-verified on the real Railway deployment 2026-08-31**: `/start` → resume upload → search → both the tailored-resume PDF and the cover-letter PDF arrived as real file attachments in Telegram, confirmed by the user.

**Design note:** materials are generated and sent automatically for every shortlisted job right now — there's no "approve before I generate this" gate yet. That's intentional and matches the roadmap's own phase split: Phase 7 is specifically where the interactive approve/decline step gets built on top of this. Every message already ends with an explicit "nothing here is submitted automatically" reminder in the meantime.

## Phase 7 — Approval stays human-in-the-loop ✅ done and verified live

Turns out most of this phase already existed — it was built for the original
single-owner website flow (`prepareApplicationForTelegram` /
`processTelegramApprovalCallback` / signed, single-use, replay-proof callbacks,
already proven in `applicationReplay.integration.test.ts`) and just needed
connecting to the bot-first flow instead of being rebuilt.

- [x] `telegramBot/handler.ts`'s `runInitialSearch` no longer sends an
  informational-only link card + auto-generated tailored materials for every
  shortlisted job (that was Phase 6's interim behavior). It now calls the
  existing `prepareApplicationForTelegram(userId, jobId)` per job, which sends
  the same signed Approve/Decline card the website flow always used.
- [x] `applicationService.ts`'s `processTelegramApprovalCallback` now also
  returns `userId`/`jobId` (additive, non-breaking) so the webhook handler can
  look up the right profile/job for tailoring after a decision.
- [x] `telegramWebhook.ts`: on `ready_for_final_confirmation` (i.e. Approve),
  it still sends the existing final-browser-review card with the original
  apply link — **unchanged, per the non-negotiable guardrail in
  `OVERVIEW.md`/`DECISIONS.md` D2** — and *now also* calls the new
  `telegramBot/tailoring.ts`'s `sendTailoredMaterialsForJob()` to generate and
  deliver the tailored PDFs at that point. On Decline, nothing is generated —
  no LLM/PDF cost is spent on jobs the user didn't ask about.
- [x] `pnpm check`/`test` (44 passed)/`build` all clean.

**Live-verified on the real Railway deployment 2026-08-31**: sent `/start`, ran a fresh search, tapped Approve on one shortlisted job and Decline on another. Confirmed via `railway logs --http` (8 webhook POSTs, all `200`, two long-running ones matching job-search and PDF-generation timing) and `railway logs` (no errors besides the already-expected/caught `notifyOwner` warning) that the callback → tailoring hookup fires correctly. User confirmed both PDFs arrived for the approved job; nothing was generated for the declined one.

## Phase 8 — Daily scheduler ✅ done, not yet live-tested

- [x] `server/scheduler.ts`: an in-process `setInterval` (checks once a minute) — no new dependency, no external cron service needed for the current single-instance, single-user deployment. For each row in `search_settings` with `dailyNotificationEnabled`, it compares the user's current local time (via `Intl.DateTimeFormat` against their stored `timezone`) to their `scheduledTime`, and skips if a `job_runs` row already exists for today in that timezone (`alreadyRanToday`) — so a restart or a slow tick can't double-fire within the same day.
- [x] Extracted the shared "search then message the chat" logic out of `telegramBot/handler.ts`'s old `runInitialSearch` into `telegramBot/notify.ts`'s `runSearchAndNotify(chatId, userId)` — used by both the immediate post-onboarding search and the scheduler, so the two paths can't drift.
- [x] `telegramConnections` (already existed, `userId` → `chatId`, populated at `/start`) is how the scheduler resolves who to message — no new pairing step needed.
- [x] Wired into boot: `startDailyScheduler()` called once from `server/_core/index.ts` after `server.listen`.
- [x] `scheduler.test.ts` covers the pure time-matching function (`currentHHMM`) across timezones ahead of/behind UTC, including a day-rollover case (Tokyo). The DB-dependent parts (`alreadyRanToday`, the per-row loop) aren't unit tested — consistent with how the rest of this codebase treats `getDb()`-touching logic (verified live instead, see below).
- [x] `pnpm check`/`test`/`build` all clean.

**Known limitation, accepted for now:** a single in-process timer only works correctly with exactly one running server instance. Railway currently runs one instance of this service, so this is fine, but it would silently multi-fire (or under-fire, if a scale-down races a tick) if ever scaled horizontally. Worth revisiting (e.g. a DB-level "claim" row, or a real job queue) before adding a second instance.

**Not yet live-tested** — needs a real day to pass with the scheduler running in production, at a `scheduledTime` a few minutes out, to confirm it actually fires and delivers the same shortlist + approval cards the on-demand path does. Same treatment every other phase got before being marked verified.

## Phase 8b — UX tweaks from live-user feedback (2026-08-31) ✅ done

Raised directly after Phase 7/8 went live. See
[DECISIONS.md](./DECISIONS.md)'s "Open questions raised 2026-08-31" section
for the items that were discussed but deliberately *not* built (autonomous
submission, Zapier/Composio/AgentMail, SaaS-viability), and
[ADAPTIVE_ONBOARDING_DESIGN.md](./ADAPTIVE_ONBOARDING_DESIGN.md) for the one
that was designed but not built (recruiter-style adaptive onboarding).

- [x] **Stop re-asking about already-decided jobs.** `telegramBot/notify.ts`'s
  `runSearchAndNotify` now filters `listShortlist`'s results down to jobs
  with no existing `applications` row before sending anything — a job that
  stays posted across multiple days no longer gets a fresh approval card
  every time the scheduler or an on-demand search runs. This was a real
  correctness bug, not just a UX nice-to-have: previously the code re-sent
  a card for every job on the shortlist unconditionally.
- [x] **Shortlist overview PDF.** `documentTailoring.ts`'s new
  `buildShortlistSummaryPdf()` sends a one-page PDF (rank, score, title,
  employer, location, link) for the day's *new/undecided* jobs before the
  individual Approve/Decline cards, so the user can scan everything at once
  instead of only ever seeing one job at a time. Falls back to the old
  plain-text summary if PDF generation fails for any reason.
- [x] **Paste resume text, not just upload a file.** `handler.ts`'s resume
  step now accepts a pasted text message (≥200 characters, to avoid
  misfiring on short replies) in addition to a PDF/DOCX upload, reusing
  `resumeParsing.ts`'s existing `parseResumeText` directly.
- [x] **Radius as buttons.** The "what search radius?" onboarding step now
  sends inline quick-pick buttons (25/50/75/100 km) via a new
  `telegram.ts` `sendButtonMessage()` helper, alongside still accepting a
  typed number. `telegramWebhook.ts` routes `radius:<n>` button taps through
  the same `advanceOnboardingStep()` the text path uses (extracted from
  `handler.ts` so both input methods can't drift apart).
- [x] `pnpm check`/`test`/`build` all clean.

**Not done, deliberately, per this pass's scope:**
- [ ] Buttonizing target-titles/location — free-text entry doesn't reduce
  to a fixed button set the way radius does; not attempted.
- [ ] A general Telegram bot command menu (`/status`, `/settings`, etc.) —
  noted as a nice-to-have, not built this pass.

## Phase 10 — Structured-ATS auto-submission (Greenhouse pilot) 🚧 in progress

Scope decided in [DECISIONS.md](./DECISIONS.md) D5, 2026-08-31, after an
explicit request to reopen part of D2. Read D5 first — this section only
tracks build status, not the reasoning.

Confirmed design: Approve (existing) → bot fills the real Greenhouse apply
form + uploads the tailored resume PDF via Playwright, **does not submit**
→ sends a screenshot of the filled form and any unmappable custom questions
→ user replies CONFIRM (submits for real) or DECLINE (aborts, nothing sent).
Non-Greenhouse jobs are completely unaffected — they keep exactly today's
manual-link behavior.

- [x] Runs on Camoufox (`camoufox-js`, Apify's Playwright-compatible Node
  port) rather than plain Chromium — swapped in after being flagged as a
  better-documented fit for minimal Linux containers; see DECISIONS.md D5's
  update note. Confirmed locally: `npx camoufox-js fetch` downloads cleanly
  (~558MB total, meaningfully bigger than plain Chromium — a real
  Railway build-time/size cost worth knowing going in) and a real
  launch+navigate smoke test passes. **Still unproven on Railway itself** —
  that's the next real unknown, same as the migration-on-boot workaround
  that came out of Phase 2's live test.
- [ ] `server/autoApply/greenhouse.ts`: detect a Greenhouse-hosted apply URL
  (`boards.greenhouse.io` / `job-boards.greenhouse.io`), map common fields
  (name, email, phone, resume upload) from the candidate profile, screenshot
  the filled-but-unsubmitted form, and separately report any custom
  questions it couldn't map.
- [ ] New `applications.status` value(s) and a second signed, single-use
  callback (same nonce/replay-protection pattern as the existing Approve
  callback) for the CONFIRM/DECLINE step, so this doesn't weaken the
  existing anti-replay guarantees.
- [ ] Wire into `applicationService.ts`/`telegramWebhook.ts`: on Approve,
  if the job's `originalApplyUrl` matches a supported Greenhouse pattern,
  branch into the new fill→screenshot→confirm flow instead of
  `sendFinalBrowserReviewCard`. Otherwise, unchanged.
- [ ] Detect CAPTCHA/bot-detection on the target page and fall back
  gracefully to the manual-link flow rather than failing silently.
- [ ] Tests: field-mapping logic tested against fixture HTML (no live
  network calls in the test suite) — the same "pure logic vs. I/O" split
  used everywhere else in this codebase.

**How this gets verified live, and why it's different from every prior
phase:** every previous phase's "live-verify" step was safe to redo freely.
This one isn't — past the dry-run/screenshot stage, a true end-to-end check
means a real application reaching a real employer for a real posting, which
cannot be undone or repeated casually. Verification here is staged:
first confirm the dry-run/screenshot step works correctly (safe, repeatable,
no real submission), and only do a real CONFIRM against an actual posting
the user is genuinely willing to apply to.

## Phase 9 — Retire or shrink the web dashboard

- [ ] Decide: keep `client/` as a thin read-only admin/debug view, or remove it once the bot covers the full loop
- [ ] If removed: decide what (if anything) replaces `server/_core/vite.ts`'s static-serving role

---

## Deliberately deferred, not gaps

- **Multi-user rollout** — the schema and bot identity flow (`getOrCreateUserForChat`)
  already support it per-user; D3 in [DECISIONS.md](./DECISIONS.md) is a
  rollout-scoping choice, not a technical blocker. Revisit once single-user
  is proven reliable.
- **Autonomous submission** — D2 is unchanged and non-negotiable absent an
  explicit, separate decision to revisit it. See DECISIONS.md's open
  questions section for the full reasoning (asked and answered directly on
  2026-08-31).

## Open questions to resolve before/during the phase they block

- **Phase 4:** exact job-search API and its rate/geographic limits — confirm before writing the client.
- **Phase 6:** which OpenRouter model(s) for parsing vs. tailoring vs. any future routing — `DEFAULT_OPENROUTER_MODEL` is a placeholder, not a final choice.
- **Phase 9:** whether the dashboard has any value once the bot is the primary interface, or if it should just go away.
