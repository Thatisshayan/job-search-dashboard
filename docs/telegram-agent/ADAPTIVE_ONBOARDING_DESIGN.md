# Design: adaptive, recruiter-style onboarding

Status: **designed, not implemented.** This is a design doc, not a roadmap
commitment — see [ROADMAP.md](./ROADMAP.md) Phase 6 for how it fits the
overall sequencing. Written in response to a direct ask: "can we make the
bot like a recruiting agency agent — ask questions, then determine the
pattern?"

## What exists today

Onboarding (`server/telegramBot/onboarding.ts`'s `planTextStep`) is a fixed,
linear state machine with exactly one path:

```
awaiting_resume -> awaiting_target_titles -> awaiting_location -> awaiting_radius -> idle
```

Each step asks one fixed question, accepts one fixed answer shape (comma
list / free text / a number, now also a radius quick-pick button — see
Phase 8 tweaks), and validates it with plain string/number checks. No LLM is
involved in this flow at all — the AI only touches resume parsing and
document tailoring elsewhere in the pipeline.

This is deliberately simple: it's fully unit-testable with zero mocks
(`onboarding.test.ts`), cheap (no LLM calls), and predictable (the same
input always produces the same transition). That's worth stating plainly
before proposing anything more complex — the fixed FSM is a real strength,
not just a placeholder.

## What "recruiter-style" actually means

A human recruiter doesn't run a fixed script. They:

1. Ask an open question ("tell me about what you're looking for").
2. Infer several structured facts from one free-form answer (role, seniority,
   location preference, must-haves, deal-breakers) instead of one fact per
   question.
3. Ask a *targeted* follow-up only for what's still missing or ambiguous
   ("you said 'construction management roles' — are you open to assistant
   coordinator titles too, or only lead/senior?").
4. Adjust tone/pacing based on how much the candidate already said.

That's a genuinely different architecture: an LLM-driven **slot-filling
loop**, not a linear FSM. It's a real, valuable idea — and a real, non-trivial
scope increase. It should not be built as an incremental patch on top of
`planTextStep`; it replaces the orchestration model for this one part of the
bot.

## Proposed design

### Structured target: same fields, different collection mechanism

The end state is unchanged — `searchSettings` still needs `targetTitles`,
`city`, `radiusKm` (and could grow more fields once this is adaptive, e.g.
seniority level, must-have vs. nice-to-have skills, salary floor). What
changes is *how* those get filled.

### State shape

Replace the fixed `OnboardingState` enum for the post-resume steps with a
single `awaiting_preferences` state holding a **slot-filling context**:

```ts
type PreferenceSlots = {
  targetTitles: string[] | null;
  city: string | null;
  radiusKm: number | null;
  seniority: "entry" | "mid" | "senior" | "any" | null;
  mustHaves: string[];       // free-text deal-breakers, e.g. "remote only"
  turnsSoFar: number;        // hard cap, see guardrails below
};
```

### The loop

1. After resume parsing, send one open prompt: *"What kind of roles are you
   looking for, and where? Tell me as much or as little as you want — I'll
   ask follow-ups for anything I still need."*
2. Every reply goes through an LLM call with a **strict JSON-schema
   response** (same pattern as `resumeParsing.ts`/`documentTailoring.ts` —
   this codebase already has the "structured extraction, then validate
   before trusting it" pattern down cold) that:
   - Extracts whichever slots the message actually answers (merge into
     existing `PreferenceSlots`, never overwrite a filled slot with null).
   - Returns `nextQuestion: string | null` — a single, specific follow-up for
     the next-most-important empty/ambiguous slot, or `null` if everything
     required (`targetTitles`, `city`, `radiusKm`) is filled.
3. If `nextQuestion` is present, send it and stay in `awaiting_preferences`.
   If `null`, transition to `idle` exactly like today's final step
   (`saveSearchSettingsFromOnboarding` + `runSearchAndNotify`).

### Guardrails (non-negotiable, matching this project's existing guardrail
philosophy in `db.ts`'s seed data and the resume/tailoring prompts)

- **Never infer `radiusKm` or `city` from vibes** — if the candidate says
  "somewhere in the GTA," ask them to name a city/radius explicitly rather
  than guessing a number. Same "don't invent facts" discipline as
  `documentTailoring.ts`'s system prompt.
- **Hard turn cap** (e.g. 6 exchanges). If slots still aren't filled by then,
  fall back to the current fixed questions for whatever's missing
  ("Let's keep it simple — what's the radius in km?"). An LLM loop that
  never terminates is a real failure mode, not a hypothetical one.
- **Every LLM output validated before use**, same pattern as elsewhere:
  `targetTitles` must be non-empty strings, `radiusKm` must be a plausible
  number (reuse `planTextStep`'s existing 1–500 bound), `city` must be
  non-trivial text. Reject and re-ask rather than silently accepting
  malformed output.
- **Keep the old FSM in the codebase** as the fallback path (see above) and
  as the thing this loop bottoms out into once slots are filled — don't
  duplicate `saveSearchSettingsFromOnboarding`/`runSearchAndNotify` wiring.

### What this costs that the current FSM doesn't

- An LLM call per onboarding turn (small, but not free — `DEFAULT_OPENROUTER_MODEL`
  cost, same model family already used for resume parsing).
- Real testing effort: `onboarding.test.ts`'s zero-mock purity goes away for
  this path; the extraction step needs the same "mock `invokeLLM`, verify
  the filtering" test shape as `documentTailoring.test.ts`.
- More surface area for a bad LLM turn to produce a confusing conversation —
  worth a "type /restart to start over" escape hatch regardless of how good
  the guardrails are.

## Recommendation

Build this as an isolated module (`server/telegramBot/adaptiveOnboarding.ts`)
that the handler can switch to per-user or globally via a flag, rather than
deleting the existing FSM. That keeps the current zero-cost, fully-tested
path available as a fallback (and as the thing new users get by default
until this is proven out) while the adaptive version is validated live.

Not started. Revisit once Phase 8's live scheduler check and the other
in-flight UX tweaks (shortlist PDF, pasted-resume intake, radius buttons)
are confirmed working.
