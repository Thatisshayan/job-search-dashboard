import type { OnboardingState } from "./db";

export type TextStepResult =
  | { ok: true; nextState: OnboardingState; context: Record<string, unknown>; reply: string }
  | { ok: false; reply: string };

const DEFAULT_SCHEDULED_TIME = "07:30";

function summarizeSettings(context: Record<string, unknown>): string {
  const track = context.track === "general" ? "immediate/general work" : "career";
  const city = typeof context.city === "string" ? context.city : "";
  const radiusKm = typeof context.radiusKm === "number" ? context.radiusKm : 0;
  if (context.track === "general") {
    return `I'll match you against general/immediate-hiring roles near ${city} (within ${radiusKm} km).`;
  }
  const targetTitles = Array.isArray(context.targetTitles) ? (context.targetTitles as string[]) : [];
  return `I'll match you against: ${targetTitles.join(", ")}, near ${city} (within ${radiusKm} km).`;
}

function finalizeReply(context: Record<string, unknown>): string {
  const summary = summarizeSettings(context);
  const scheduleNote = context.dailyNotificationEnabled
    ? `I'll check automatically every day at ${context.scheduledTime} and message you here if anything new turns up.`
    : "I won't check automatically — say /edit any time to update your search (or just re-confirm it) and I'll search again then.";
  return `${summary}\n\nSearching for matching roles now — one moment…\n\n${scheduleNote}\n\nTip: if there's a specific company you want tracked closely, send /watch <company> (e.g. /watch acme, or paste their careers page link) and I'll include their own postings too.`;
}

/**
 * Pure state-transition logic for every plain-text (or button-tap-supplied)
 * onboarding step. Kept free of any I/O (DB/LLM/Telegram) so it's
 * unit-testable without mocking any of those. Two steps aren't here because
 * they're inherently async (download/LLM calls): the resume-upload step
 * (`awaiting_resume`) and the resume-build intake step
 * (`awaiting_resume_build`) — see `handleResumeUpload`/`handleResumeBuildIntake`
 * in handler.ts.
 */
export function planTextStep(state: OnboardingState, text: string, context: Record<string, unknown>): TextStepResult {
  const trimmed = text.trim();
  const normalized = trimmed.toLowerCase();

  if (state === "awaiting_track_choice") {
    const isGeneral = normalized === "1" || ["general", "immediate"].some(token => normalized.includes(token));
    const isCareer = normalized === "2" || normalized.includes("career");
    if (!isGeneral && !isCareer) {
      return { ok: false, reply: "Sorry, I didn't catch that — are you looking for immediate/general work, or career-focused work? Reply with \"immediate\" or \"career\"." };
    }
    const track = isGeneral ? "general" : "career";
    return {
      ok: true,
      nextState: "awaiting_resume_choice",
      context: { ...context, track },
      reply: "Got it. Do you already have a resume ready to share, or would you like help building one?",
    };
  }

  if (state === "awaiting_resume_choice") {
    const wantsBuild = normalized === "2" || ["build", "help"].some(token => normalized.includes(token));
    const hasReady = normalized === "1" || ["ready", "have"].some(token => normalized.includes(token));
    if (!wantsBuild && !hasReady) {
      return { ok: false, reply: "Reply \"ready\" if you have a resume to share, or \"build\" if you'd like help building one." };
    }
    if (wantsBuild) {
      return {
        ok: true,
        nextState: "awaiting_resume_build",
        context,
        reply: "No problem — tell me about yourself: your current or most recent job title, your experience, and your top skills. A few sentences is enough; I'll turn that into a working profile.",
      };
    }
    return {
      ok: true,
      nextState: "awaiting_resume",
      context,
      reply: "Great — send it as a PDF or Word (.docx) file, paste the text of your resume directly, or paste a public LinkedIn/Indeed profile link.",
    };
  }

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
    return {
      ok: true,
      nextState: "awaiting_recurring_choice",
      context: { ...context, radiusKm },
      reply: "Last thing: want me to check for new matches automatically every day, or would you rather search on demand only? Reply \"yes\" or \"no\".",
    };
  }

  if (state === "awaiting_recurring_choice") {
    const wantsRecurring = normalized === "yes" || normalized === "y" || normalized.includes("daily") || normalized.includes("every day");
    const declines = normalized === "no" || normalized === "n" || normalized.includes("on demand") || normalized.includes("on-demand");
    if (!wantsRecurring && !declines) {
      return { ok: false, reply: "Reply \"yes\" for daily automatic checks, or \"no\" to search on demand only." };
    }
    if (!wantsRecurring) {
      const finalContext = { ...context, dailyNotificationEnabled: false, scheduledTime: DEFAULT_SCHEDULED_TIME };
      return { ok: true, nextState: "idle", context: finalContext, reply: finalizeReply(finalContext) };
    }
    return {
      ok: true,
      nextState: "awaiting_recurring_time",
      context: { ...context, dailyNotificationEnabled: true },
      reply: "What time should I run the daily check? (24-hour format, e.g. \"07:30\")",
    };
  }

  if (state === "awaiting_recurring_time") {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) {
      return { ok: false, reply: "Give me a time in 24-hour HH:MM format (e.g. \"07:30\" or \"18:00\")." };
    }
    const finalContext = { ...context, scheduledTime: trimmed };
    return { ok: true, nextState: "idle", context: finalContext, reply: finalizeReply(finalContext) };
  }

  return { ok: false, reply: "You're all set for now — nothing to update here yet." };
}
