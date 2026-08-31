# Scoping doc: Zapier / Composio / AgentMail — real use cases, not a checklist

Status: **scoping only, nothing built.** Written in response to a direct
ask: the user named these three tools without a specific use case in mind
and asked whether there's a real one worth building. This document proposes
concrete, app-specific use cases for each, evaluates them against this
project's existing guardrails (D1/D2/D3 in [DECISIONS.md](./DECISIONS.md)),
and recommends a priority order. None of this is scheduled — pick one if
any of it is worth pursuing.

First, the distinction that matters before any of this: **these are tools
available to Claude Code (the assistant building this project) inside this
development session — they are not available to the deployed Telegram bot
at runtime.** The bot is a separate, already-running Node service on
Railway. Giving *it* any of these capabilities means writing new server
code that calls that service's own HTTP API directly, the same way
`server/jobSearch/adzuna.ts` calls Adzuna today. Nothing here is a
configuration flip.

## AgentMail — closes a real gap in the current pipeline

**The gap:** `originalApplyUrl` throughout this codebase (`jobs` table,
`verifiedListingImport.ts`, `applicationService.ts`) assumes every posting
has a web URL to apply through. In practice — especially in the
construction/trades vertical this project started in, and likely still true
generically — some real postings list "email your resume to
jobs@company.com" as the *entire* apply mechanism. Today, a listing like
that either gets excluded during import or is handled incorrectly (treated
as if it had a normal apply URL when it doesn't).

**Proposed use case 1 — send-by-email as a third apply path**, alongside
today's manual-link flow and Phase 10's Greenhouse auto-submit: when a
job's apply mechanism is an email address, AgentMail gives the bot a real
inbox to send the tailored resume PDF + cover letter as an actual outbound
email, subject/body written from the same tailored materials
`documentTailoring.ts` already generates. Still gated behind the existing
Approve tap — same D2 guardrail, just a different final delivery mechanism
than "here's a link" or "I filled out this form."

**Proposed use case 2 — close the loop after applying**, which nothing in
the current stack does at all: give the bot a real inbox address the
candidate could optionally use *as* their contact email for applications
(or a forwarding address), so employer replies (interview requests,
rejections, follow-up questions) land somewhere the bot can read, parse, and
relay to the user in Telegram — "Acme Corp replied to your Construction
Coordinator application: they want to schedule a call." This is a genuinely
new capability, not automating something that already exists elsewhere in
the app.

**Risk/complexity:** use case 1 is a small, additive change (new delivery
path, same approval gate). Use case 2 is a bigger scope increase — parsing
arbitrary inbound email reliably (distinguishing a real interview request
from an autoresponder, spam, or an unrelated email) is a real NLP/heuristics
problem, and there's a privacy consideration in routing a candidate's real
correspondence through this system at all. Worth a separate design pass if
pursued.

**Recommendation: use case 1 only, and only once a real email-apply-only
posting is actually seen from Adzuna's results** — right now this is a
plausible gap, not a confirmed one. Worth checking what fraction of real
Adzuna results are email-apply-only before building anything.

## Composio — a genuinely different, lower-risk use case than the one already tried

This project's own `todo.md` documents a prior attempt to use Composio for
job-board integrations (LinkedIn/Indeed) that hit a wall — those platforms'
own ToS and technical defenses, the exact reason D1 chose legitimate
job-aggregator APIs over scraping in the first place. Composio isn't a
workaround for that; re-attempting job-board access through it would hit
the same wall D1 already rejected.

**Proposed use case — calendar scheduling, not job discovery:** if
AgentMail's use case 2 above (or any future channel) ever lets the bot see
an employer's reply proposing an interview time, Composio's Google Calendar
action could create the calendar event automatically rather than the user
doing it by hand. This is a fundamentally different risk profile than the
LinkedIn/Indeed attempt: a calendar write is low-stakes, easily reversible
(delete the event), and doesn't touch any job board's ToS at all.

**Recommendation: don't pursue independently of AgentMail's use case 2** —
this only has a real trigger once there's a real "employer replied"
signal to act on. Not a first move on its own.

## Zapier — the "glue" role, not a bespoke integration

**Proposed use case:** many users already track their job search in a tool
they picked themselves — a Notion database, a Google Sheet, an Airtable
base. Rather than this project building bespoke exporters for each, Zapier
lets a user connect *their own* destination and have every shortlisted or
applied-to job land there automatically, without new code per destination
platform.

**Why this is a decent fit specifically for a Zapier-shaped solution:** it's
a one-way, read-only export of data this app already has and already
computes (`shortlistEntries`, `applications`) — no new inbound risk, no new
guardrail interaction with D1/D2, and the "connect whatever tool you
already use" flexibility is exactly what Zapier is for, versus building and
maintaining N bespoke integrations ourselves.

**Recommendation: the lowest-risk of the three to build if this project
ever wants an integrations story**, precisely because it's one-way/export
and touches nothing safety-relevant (no submission, no discovery, no ATS
automation). Still not scheduled — no user has asked for a personal-tracker
export yet; this is "if this ever comes up" scoping, not a plan.

## Priority if any of this gets picked up

1. **Zapier export** — lowest risk, clearest single use case, no
   interaction with D1/D2/D5's guardrails at all.
2. **AgentMail use case 1** (send-by-email apply path) — only once an
   email-apply-only posting is actually confirmed in real Adzuna results;
   otherwise this is solving a hypothetical.
3. **AgentMail use case 2 + Composio calendar** — bundled together since
   Composio's use case depends on AgentMail's inbound-email parsing existing
   first; meaningfully bigger scope (reliable inbound email parsing) than
   either 1 or 2 alone.

Not started. Revisit if/when a concrete trigger (a real email-only posting,
a user asking for a personal-tracker export) makes one of these worth
building rather than speculative.
