import type { OnboardingState } from "./db";

export type TextStepResult =
  | { ok: true; nextState: OnboardingState; context: Record<string, unknown>; reply: string }
  | { ok: false; reply: string };

/**
 * Pure state-transition logic for the three plain-text onboarding steps
 * (titles -> location -> radius). Kept free of any I/O (DB/LLM/Telegram) so
 * it's unit-testable without mocking any of those. The resume-upload step
 * isn't here because it's inherently async (download + LLM parse) — see
 * `downloadAndParseResume` in resumeParsing.ts and the orchestration in
 * `handleOnboardingMessage` below.
 */
export function planTextStep(state: OnboardingState, text: string, context: Record<string, unknown>): TextStepResult {
  const trimmed = text.trim();

  if (state === "awaiting_target_titles") {
    const titles = trimmed.split(",").map(title => title.trim()).filter(Boolean);
    if (titles.length === 0) {
      return { ok: false, reply: "I didn't catch any role titles there. List one or more, separated by commas (e.g. \"Software Engineer, Backend Developer\")." };
    }
    return {
      ok: true,
      nextState: "awaiting_location",
      context: { ...context, targetTitles: titles },
      reply: "Got it. What city or region should I search near? (e.g. \"Toronto, Ontario\")",
    };
  }

  if (state === "awaiting_location") {
    if (trimmed.length < 2) {
      return { ok: false, reply: "That doesn't look like a location — what city or region should I search near?" };
    }
    return {
      ok: true,
      nextState: "awaiting_radius",
      context: { ...context, city: trimmed },
      reply: "And what search radius, in kilometers? (e.g. \"50\")",
    };
  }

  if (state === "awaiting_radius") {
    const radiusKm = Number.parseInt(trimmed, 10);
    if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 500) {
      return { ok: false, reply: "Give me a radius in kilometers as a plain number between 1 and 500 (e.g. \"50\")." };
    }
    const targetTitles = Array.isArray(context.targetTitles) ? (context.targetTitles as string[]) : [];
    const city = typeof context.city === "string" ? context.city : "";
    return {
      ok: true,
      nextState: "idle",
      context: { targetTitles, city, radiusKm },
      reply: `You're set. I'll match you against: ${targetTitles.join(", ")}, near ${city} (within ${radiusKm} km).\n\nSearching for matching roles now — one moment…\n\n(Heads up: this runs on-demand for now. Automatic daily searching is still being built — I'll let you know here as soon as it is.)`,
    };
  }

  return { ok: false, reply: "You're all set for now — nothing to update here yet." };
}
