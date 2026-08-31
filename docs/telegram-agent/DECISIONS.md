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

## Open questions raised 2026-08-31, not yet decided

These came up directly after Phase 7/8 live verification. Recorded here
so they don't get lost, but **none of them change D1–D4** — they're
explicitly flagged as open rather than acted on unilaterally, because each
one either reopens a "non-negotiable" guardrail or is a real scope/cost
increase.

### Revisiting D2 (human-in-the-loop) — autonomous submission

The direct question was asked: "where is the autonomous applying?" To be
explicit about where things stand: **D2 is still in effect.** The bot
prepares everything (scored match, tailored resume + cover letter PDFs,
signed Approve/Decline card) and the final submission is still always a
human clicking through to the employer's own site. This was chosen
*deliberately* earlier in this project after an explicit risk pushback
(fragile generic form-automation, ToS exposure on employer sites, silent
failure modes with real consequences — ATS spam, a hallucinated cover-letter
claim reaching a real employer, duplicate submissions) and the user chose to
scale back from "fully autonomous" to "human final click" at that time.

Reopening it is the user's call to make explicitly, not something to slide
back in as a side effect of an unrelated feature request. If revisited, the
smallest-risk middle ground already flagged in D2 is auto-submission scoped
to a handful of script-friendly ATS platforms (Greenhouse/Lever/Workable)
rather than arbitrary employer sites — still a real scope increase, with its
own new failure modes (wrong-field mapping, ATS-side rate limiting/blocking)
that would need their own design pass before being built.

### Tool integrations (Zapier / Composio / AgentMail / similar)

Important distinction that came up: these are tools available to *Claude
Code* (the assistant building this project) inside this development
session — they are **not** available to the deployed Telegram bot at
runtime. The bot is a separate, already-running service on Railway; giving
it "AgentMail" or "Zapier" capability means writing new server code that
calls those services' own HTTP APIs directly from `server/`, the same way
`server/jobSearch/adzuna.ts` calls Adzuna's API today. It is not a
configuration flip.

Not pursued yet because none of them have a concrete use case attached —
e.g. AgentMail could plausibly let the bot manage a real inbox to send
applications by email (useful for employers whose "apply" flow *is* an email
address), but that only matters once a real employer with an email-only
apply flow shows up in practice. Revisit once a specific job/task needs one
of these, rather than integrating speculatively.

### Is this whole product idea sound as a SaaS?

Distinct from "is the code SaaS-ready" (an engineering checklist — see
Phase 9). The underlying product question is whether "AI resume-tailoring +
human-approved job applications over Telegram" is a good SaaS to build at
all. Worth a real answer, not just an engineering gap list:

The core loop (discover → score → tailor → human-approve) is a genuinely
useful wedge — the tailoring quality already proven live is the hard part
most competitors skip. The honest risks for a SaaS specifically: (1) legal
exposure scales with users — one person self-serving their own job search
under D1/D2's guardrails is very different from operating this as a service
for strangers, especially around Adzuna's terms (a paid/commercial tier may
be required past its free tier) and OpenRouter usage costs per user; (2)
distribution is the actual hard problem here, not the tech — job-search
tools are a crowded, low-trust category; (3) Telegram-only limits reach
compared to a web/email-based competitor. None of these are blockers, but
none of them get easier by writing more code before validating that a
handful of real users outside the founder want this. Recommendation: prove
retention and outcome quality (did a shortlisted, tailored application
actually get more responses?) with a small group before treating this as a
SaaS decision rather than a personal-tool decision.

## D5 — Structured-ATS auto-submission: revising D2's scope (2026-08-31)

**Chosen, explicitly, after the open question above was raised and answered:**
build real automated submission, but **only** for jobs hosted on a small set
of standardized ATS platforms (starting with Greenhouse), and **only** as
automating the mechanical *how* of submission — not removing the human
decision of *whether* to apply. The existing Approve tap (D2's original
guardrail) still gates everything. What's new is a second, explicit,
separately-worded confirmation immediately before the actual irreversible
submit, shown alongside a screenshot of the filled-but-unsubmitted form:

```
Approve (existing) -> bot fills the real Greenhouse form + uploads the
tailored resume PDF, does NOT click submit -> sends a screenshot of the
filled form + "Reply CONFIRM to submit for real, or DECLINE to abort" ->
only on CONFIRM does it click the real submit button.
```

This does not reverse D2's core reasoning (silent, consequential failure
modes deserve a human check) — it adds automation to the *filling* step,
which was always the safe, reversible part, while keeping a human check
immediately before the one truly irreversible action. Every job not hosted
on a supported ATS platform keeps the exact D2 behavior unchanged (link
handed to the human to submit manually).

**Why this wasn't just built directly on the original "go ahead" ask:**
the previous open-questions entry above was explicit that reopening D2 is
the user's call, and it was then made explicitly, with two further specifics
confirmed directly: (1) the field-mapping-mistake risk is real enough to
warrant the extra screenshot+confirm step rather than one-tap full autonomy,
and (2) Greenhouse first, not Lever or both, to prove the pattern on the
more standardized of the two before expanding.

**Real, load-bearing technical constraint, stated plainly:** neither
Greenhouse nor Lever exposes a public API for a third party to submit an
application on a candidate's behalf. The only mechanism is browser
automation against the same public HTML apply pages a human would use
(Playwright driving a real Chromium instance: navigate, fill fields by
matching common Greenhouse field names/ids, upload the resume PDF via
`setInputFiles`, screenshot, and — only after CONFIRM — click the real
submit button). This is meaningfully more fragile and harder to test safely
than everything built so far in this project:

- There is no sandbox environment for Greenhouse's real boards — every true
  end-to-end test (past the dry-run/screenshot stage) submits a real
  application to a real employer for a real posting. The dry-run/screenshot
  step exists specifically so the *first* live check doesn't have to be a
  real submission.
- Custom screening questions vary per employer and can't all be mapped
  automatically — unmappable questions must be surfaced to the user in the
  screenshot/confirm message rather than silently left blank or guessed.
- Some Greenhouse boards front their apply form with CAPTCHA/bot-detection
  (Cloudflare Turnstile and similar) that this approach cannot solve; those
  postings should be detected and gracefully fall back to D2's manual-link
  behavior rather than failing silently.
- Running headless Chromium in the Railway container is untested — it's a
  meaningfully bigger, slower build than every dependency added so far
  (browser binary download, possibly missing system libraries Railway's
  build image doesn't include by default). This may need its own follow-up
  fix once actually deployed, the same way the migration-on-boot workaround
  emerged from Phase 2's live test rather than being predictable in advance.

**Rejected: Lever or both platforms from the start.** Greenhouse's public
apply-page markup is more standardized across different employers' boards;
proving the pattern once before expanding it reduces the chance of building
the wrong abstraction against two platforms' quirks simultaneously.

**Rejected: no extra confirmation, Approve alone submits.** Considered
because it's what "autonomous" most literally means, but rejected because a
bad field mapping or an unmappable custom question would then reach a real
employer with nobody having seen the filled form first — exactly the
"silent, consequential failure" mode D2 was originally written to avoid.
The screenshot+CONFIRM step keeps that check in place while still
automating the tedious part.

**Noted fallback, not adopted:** if plain Playwright+Chromium gets blocked
by a Greenhouse board's bot-detection, an anti-detection browser fork
(e.g. [Camoufox](https://github.com/daijro/camoufox)) is a known option —
flagged by the user as "not that we have to use them, but in case." Not
adopted as the default because deliberately evading bot-detection is a
further escalation in posture beyond "automate what a human would click,"
and deserves its own explicit decision if plain Chromium proves insufficient
rather than being reached for preemptively.

See [ROADMAP.md](./ROADMAP.md) Phase 10 for implementation status.
