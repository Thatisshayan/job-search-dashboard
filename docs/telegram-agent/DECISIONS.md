# Decisions

Each entry: the decision, why, and — since we were explicitly asked to
document the unnecessary/rejected paths too — what was considered and not
chosen.

## D1 — Job discovery: legitimate APIs, not scraping

**Chosen:** Query legitimate job-aggregator APIs (Adzuna and similar
services with official free/cheap tiers) against the user's stated target
roles/locations.

**Rejected: scraping job boards directly.** This was the initial ask.
Rejected because most major job boards' Terms of Service prohibit
automated scraping, several (LinkedIn notably) have both technical
anti-scraping defenses and a history of litigation against scrapers
(*hiQ Labs v. LinkedIn*, *Meta v. Bright Data*), and this project's own
`todo.md` already documents this exact wall being hit repeatedly even with
a *legitimate* API attempt (Composio → LinkedIn/Indeed), let alone a
scraper. Coverage from legitimate APIs is narrower, but it doesn't carry
per-request legal/ToS exposure or the maintenance burden of scrapers
breaking every time a site changes its markup.

**Rejected: "user forwards a link" only.** Considered as a zero-risk
fallback (no autonomous discovery at all, just score whatever the user
pastes). Not chosen as the primary mechanism because it doesn't satisfy
"daily automatic search," but it's worth keeping in mind as a cheap
day-one fallback if the chosen API's coverage turns out to be too thin for
a given user's role/location.

## D2 — Auto-apply scope: human final click retained

**Chosen:** The bot does everything up to and including generating tailored
application materials and asking for approval — but the last step is still
the user manually submitting on the employer's own site, exactly like
today's Telegram flow.

**Rejected: fully autonomous submission on any site.** This was the initial
ask. Rejected because generic form-filling automation (e.g. Playwright
driving arbitrary employer websites) is genuinely fragile — different
forms, file uploads, logins, multi-step wizards, CAPTCHAs — and the failure
mode when it goes wrong is silent and consequential: a wrong resume
attached, a hallucinated cover-letter detail, or a duplicate submission
reaching a real employer with no human catching it first. The existing
approval workflow (`server/telegram.ts`, `server/applicationService.ts`)
was already deliberately built and tested around never auto-submitting
(see `applicationReplay.integration.test.ts`, and the message strings in
`telegram.ts` like *"It never submits an employer form"*) — reversing that
is a decision that deserves to be revisited explicitly and separately, not
folded into a broader feature pivot.

**Rejected: auto-apply scoped to a few easy ATS platforms** (Greenhouse,
Lever, Workable). A real middle ground worth reconsidering later — these
platforms have more structured, more script-friendly apply flows than
arbitrary employer sites — but out of scope for now given the guardrail
above.

## D3 — Multi-tenancy: single-user first, schema stays ready

**Chosen:** Onboard one Telegram user (the product owner) first. Every
table already carries a `userId` column, so this is a scoping decision for
*rollout*, not a database redesign later.

**Rejected: multi-user from day one.** This was the initial ask. Rejected
for now because combined with D1/D2's original (rejected) scope, many users
running scraping + autonomous submission would have turned this from
"personal automation" into "operating a scraping/auto-submission service
for third parties" — a materially different legal and reputational risk
category. With D1/D2 scaled back to legitimate APIs and a human-in-the-loop
final step, multi-user is a much smaller ask and can be revisited once the
single-user flow is proven reliable.

## D4 — LLM provider: OpenRouter

**Chosen:** OpenRouter (`OPENROUTER_API_KEY`), OpenAI-compatible
`/chat/completions` and `/models` endpoints.

**Why:** `server/_core/llm.ts` already spoke the OpenAI-compatible format
(it was built against Manus's "Forge" proxy, which mirrors that shape), so
this was close to a drop-in swap rather than a rewrite (Phase 1, done — see
[ROADMAP.md](./ROADMAP.md)). It also incidentally advances a separate,
earlier goal (decoupling this app from the Manus platform) for the AI piece
specifically — storage, maps, and other Manus-proxy scaffolding are a
separate, not-yet-scoped concern.

**Rejected: keep using Manus's Forge proxy.** Would have worked, but ties a
core piece of new product functionality to a platform this project is
otherwise trying to reduce dependence on.

**Not decided yet:** which specific model(s) to use for résumé parsing vs.
tailored-document generation vs. any future conversational routing. Phase 1
added a `DEFAULT_OPENROUTER_MODEL` constant (`openai/gpt-4o-mini`) as a
placeholder so `invokeLLM` always sends a valid `model` field (OpenRouter
requires one); this should be revisited per use case in Phase 2/6.
