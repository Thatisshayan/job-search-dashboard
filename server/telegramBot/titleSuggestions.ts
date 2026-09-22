import { invokeLLM } from "../_core/llm";

const SUGGESTED_TITLES_SCHEMA = {
  name: "suggested_target_titles",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["titles"],
    properties: {
      titles: {
        type: "array",
        description:
          "3 to 6 realistic job title search terms this candidate could target next, based only on their real experience and skills below. Standard, recruiter-recognizable titles (e.g. 'Construction Project Manager', 'Backend Software Engineer') — not company names, not invented seniority or certifications, no duplicates.",
        items: { type: "string" },
      },
    },
  },
  strict: true,
} as const;

const SYSTEM_PROMPT = `You suggest job title search terms for a candidate's next job search, based only on their real resume experience and skills.
Suggest 3 to 6 concise, standard job titles a recruiter or job board would recognize.
Do not invent credentials, licensure, or seniority the resume doesn't support.
Titles should be realistic next-step or adjacent roles given the candidate's real experience — not aspirational leaps unsupported by the resume.`;

export type ProfileForTitleSuggestion = {
  headline: string;
  summary: string;
  skills: Record<string, string[]>;
  experience: Array<Record<string, unknown>>;
};

/**
 * Deduplicates (case-insensitively) and caps the model's suggestions, kept
 * pure/free of any I/O so it's unit-testable without mocking `invokeLLM` —
 * same pure-vs-IO split used throughout this codebase (e.g. greenhouseBoard.ts).
 */
export function dedupeTitles(titles: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of titles) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= 6) break;
  }
  return result;
}

/**
 * Phase 13: proposes target-role titles from the candidate's already-parsed
 * profile, rather than only ever relying on what the user happens to type
 * during onboarding. Never throws its own errors to the caller beyond what
 * `invokeLLM`/`JSON.parse` raise — callers must treat a failure here as
 * "no suggestions available" and fall back to the existing plain-ask flow,
 * never block onboarding on this being unavailable.
 */
export async function suggestTargetTitles(profile: ProfileForTitleSuggestion): Promise<string[]> {
  const profileText = JSON.stringify(
    {
      headline: profile.headline,
      summary: profile.summary,
      skills: profile.skills,
      experience: profile.experience,
    },
    null,
    2
  );

  const result = await invokeLLM({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `CANDIDATE PROFILE:\n${profileText}` },
    ],
    responseFormat: { type: "json_schema", json_schema: SUGGESTED_TITLES_SCHEMA },
  });

  const content = result.choices[0]?.message?.content;
  const raw = typeof content === "string" ? content : "";
  if (!raw) return [];

  const parsed = JSON.parse(raw) as { titles: string[] };
  return dedupeTitles(parsed.titles ?? []);
}
