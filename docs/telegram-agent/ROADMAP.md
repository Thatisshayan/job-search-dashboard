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

**Not verified — needs a real Telegram bot token** (none available in this dev environment):
- [ ] `sendPlainMessage` / `downloadTelegramFile` against the real Telegram Bot API
- [ ] A real end-to-end run: message a live bot, upload an actual resume file, and confirm the replies/flow feel right in the Telegram client itself

## Phase 3 — Generalize the candidate profile & scoring

- [ ] Résumé parsing produces a `candidateProfiles` row (via `invokeLLM` with a JSON-schema response format) instead of the hardcoded seed in `server/db.ts`
- [ ] `server/scoring.ts`'s `exactTitles`/`relatedTitleTerms` become derived from the user's stated target roles instead of a fixed construction list
- [ ] Location/commute logic (`isGtaLocation`) generalizes beyond the hardcoded GTA city list

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
