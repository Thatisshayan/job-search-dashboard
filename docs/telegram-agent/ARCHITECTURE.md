# Architecture

## What's being reused as-is

| Piece | File(s) | Why it's reusable |
|---|---|---|
| Deterministic scoring engine | `server/scoring.ts` | Sound design (weighted components + explicit penalties + evidence list). Needs generalizing off construction-only keyword lists (Phase 3), not a rebuild. |
| Telegram approval protocol | `server/telegram.ts`, `server/telegramWebhook.ts`, `server/applicationService.ts` | HMAC-signed, single-use, time-boxed, replay-proof (see `applicationReplay.integration.test.ts`). This is the trust boundary for the whole product — keep it exactly as-is and build on top of it. |
| Multi-tenant-ready schema | `drizzle/schema.ts` | Every table already has a `userId` column. Onboarding more users later is a rollout decision, not a migration. |
| LLM client | `server/_core/llm.ts` | Now targets OpenRouter (Phase 1). `invokeLLM`/`listLLMModels` already handle tool calls, JSON-schema output, retries with backoff — exactly what résumé parsing and document generation need. |
| Rate limiting, env validation, cookie/session handling | `server/_core/index.ts`, `server/_core/env.ts`, `server/_core/cookies.ts` | Unrelated to the pivot, keep as-is. |

## What's being replaced or heavily changed

| Piece | Current state | Change |
|---|---|---|
| Candidate profile | Hardcoded seed data for one person (`server/db.ts` → `ensureDashboardSetup`) | Becomes populated from a parsed résumé per user (Phase 2/3) |
| Job sourcing | Owner manually calls `importVerifiedListingBatch` with hand-typed listings (`server/verifiedListingImport.ts`) | Becomes an automated call to a job-search API (Phase 4) |
| Interface | React dashboard (`client/src/`) | Telegram becomes primary; dashboard's future is an open question (Phase 9) |
| Telegram webhook | Only handles `callback_query` (button clicks) — see `telegramWebhook.ts` reading `req.body?.callback_query` | Add `message` update handling: text, documents (résumé upload), commands (Phase 2) |

## New pieces

- **Conversation state.** A per-chat state machine (new table, tentatively
  `botConversations`: `chatId`, `userId`, `state`, `context` JSON,
  `updatedAt`) tracking where a user is in onboarding/review flows. Needed
  because Telegram updates are stateless HTTP calls — the bot has to
  remember "this chat is mid-upload" or "this chat is reviewing job #3 of
  5" itself.
- **Résumé storage + parsing.** Telegram document upload → `getFile` →
  download → extract text (PDF/DOCX) → `invokeLLM` with a JSON-schema
  response format to get structured skills/experience/education, matching
  the shape `candidateProfiles` already expects (`server/db.ts`).
- **Job-search API client.** A new `server/jobSearch/<provider>.ts` module
  wrapping whichever aggregator API is chosen (see `DECISIONS.md` D1),
  producing objects compatible with `VerifiedListing`
  (`server/verifiedListingImport.ts`) so the existing import/dedup/scoring
  pipeline doesn't need to change shape.
- **Tailored-document generation.** A new `server/documentTailoring.ts`:
  given a `candidateProfile` + a scored job, calls `invokeLLM` to produce a
  tailored resume summary/bullets and cover letter, constrained to only use
  facts present in the parsed résumé (mirrors the existing
  `scoringGuardrails` philosophy already in `server/db.ts`).
- **Scheduler.** A real daily trigger (evaluate `node-cron` vs. a simple
  `setInterval`-based check against each user's `scheduledTime`) driving
  discovery → score → tailor → notify per user. Nothing plays this role
  today; `scheduledTime` is currently just a stored setting no code acts on.

## Environment variables introduced so far

| Variable | Introduced in | Required? |
|---|---|---|
| `OPENROUTER_API_KEY` | Phase 1 | Not yet enforced at startup (nothing calls `invokeLLM` yet) — will become required once Phase 2/6 land. |
| `OPENROUTER_BASE_URL` | Phase 1 | Optional, defaults to `https://openrouter.ai/api/v1`. |
| *(job-search API key, TBD)* | Phase 4 | Depends on provider chosen in D1. |

See `.env.example` and `README.md` for the full current list.
