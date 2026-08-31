# Telegram Job-Search Agent — Overview

## What this is

A rework of the job-search-dashboard product from "a website showing one
person's manually-curated shortlist" into a **Telegram-native job-search
assistant**: a user talks to a bot, gives it a résumé and target roles, and
the bot searches, scores, tailors application materials, and asks for
approval — all inside a chat, no website required.

## Why this pivot

The original dashboard required a human (the owner) to manually verify and
type in every single job listing — there was never a real "search the web"
step, and `todo.md` shows a long trail of abandoned attempts to wire one in
(Composio/LinkedIn/Indeed integrations that never got past credential
issues). The website itself was also mostly unused surface area: several
pages just displayed data an owner had to have already entered by hand.

Moving the interface into Telegram removes an entire layer (the React
dashboard, its auth flow, its owner-detection UI) and replaces it with the
one interaction model that actually matters here: a conversation. It also
forces the real missing piece — actual job discovery — to finally get built,
since a bot with nothing to search is just a chatbot.

## What changes vs. today

| Today | After this rework |
|---|---|
| Website is the interface; Telegram only sends approval cards | Telegram *is* the interface; website becomes optional/secondary (see [ROADMAP.md](./ROADMAP.md) Phase 9) |
| One hardcoded candidate profile (Shayan, construction) | Any user's résumé, parsed by the bot, drives their own profile |
| Owner manually types in each "verified" listing | Bot searches real job APIs against the user's target roles |
| Fixed construction-industry keyword scoring | Scoring driven by the user's actual parsed résumé and stated targets |
| No tailored documents | Bot generates a tailored resume + cover letter per job (OpenRouter LLM) |
| Telegram approval ends at "here's the link, go apply yourself" | **Unchanged on purpose** — see [DECISIONS.md](./DECISIONS.md) for why full autonomous submission was explicitly rejected for now |
| AI calls go through Manus's Forge proxy | AI calls go through OpenRouter (`OPENROUTER_API_KEY`) — Phase 1, already done |
| Single hardcoded owner | Schema is already multi-user-ready (every table has `userId`); we're just onboarding one user for now |

## Document map

- **[ROADMAP.md](./ROADMAP.md)** — the phase-by-phase todo list. Start here to see what's done and what's next.
- **[DECISIONS.md](./DECISIONS.md)** — the calls made on job discovery, auto-apply scope, and multi-tenancy, including what was explicitly *rejected* and why.
- **[ARCHITECTURE.md](./ARCHITECTURE.md)** — what gets reused from the existing codebase, what's new, and where things live.

## Non-negotiable guardrail

**No unsupervised final submission.** Every phase of this build keeps a
human click as the last step before an application reaches an employer. This
was a deliberate decision after weighing the alternative (see
`DECISIONS.md` → "Auto-apply scope") — it is not a placeholder to be removed
later without an explicit, separate decision to do so.
