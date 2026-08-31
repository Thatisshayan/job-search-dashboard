import { invokeLLM } from "./_core/llm";
import type { CandidateProfile } from "../drizzle/schema";

const TAILORED_MATERIALS_SCHEMA = {
  name: "tailored_application_materials",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["resumeHighlights", "coverLetter", "gapsToMention"],
    properties: {
      resumeHighlights: {
        type: "array",
        description: "3-6 resume bullet points, reordered/rephrased to foreground the experience most relevant to this specific job. Each bullet must restate a fact already present in the candidate's real experience — never a new claim.",
        items: { type: "string" },
      },
      coverLetter: {
        type: "string",
        description: "A concise (3-4 short paragraphs) cover letter addressed to the employer, referencing the specific job title and grounded only in the candidate's real experience/skills.",
      },
      gapsToMention: {
        type: "array",
        description: "Any material qualification gaps between the job and the candidate's verified experience that the candidate should be aware of before applying (e.g. a licence or years of experience the resume doesn't establish). Empty array if none.",
        items: { type: "string" },
      },
    },
  },
  strict: true,
} as const;

const SYSTEM_PROMPT = `You write tailored job-application materials (resume highlights and a cover letter) for a specific job posting.

Hard rules:
- Use ONLY facts present in the candidate profile provided below (employers, titles, dates, skills, education). Never invent or infer licensure, certifications, work authorization, years of experience, or achievements not stated.
- Do not exaggerate seniority or scope beyond what the profile states.
- If the job appears to require something the profile doesn't establish, note it in gapsToMention instead of glossing over it or omitting it silently.
- Keep the cover letter professional, specific to this employer/title, and free of generic filler ("I am a hard worker", etc.) — every sentence should trace back to a real fact in the profile.`;

export type TailoredMaterials = {
  resumeHighlights: string[];
  coverLetter: string;
  gapsToMention: string[];
};

export async function generateTailoredMaterials(input: {
  profile: Pick<CandidateProfile, "displayName" | "headline" | "summary" | "skills" | "experience" | "education">;
  job: { title: string; employer: string; description: string };
  scoreRationale?: string;
}): Promise<TailoredMaterials> {
  const profileText = JSON.stringify(
    {
      name: input.profile.displayName,
      headline: input.profile.headline,
      summary: input.profile.summary,
      skills: input.profile.skills,
      experience: input.profile.experience,
      education: input.profile.education,
    },
    null,
    2
  );

  const userContent = `CANDIDATE PROFILE (verified facts only — do not use anything outside this):\n${profileText}\n\nJOB\nTitle: ${input.job.title}\nEmployer: ${input.job.employer}\nDescription: ${input.job.description.slice(0, 4000)}\n${input.scoreRationale ? `\nWhy this job was matched: ${input.scoreRationale}` : ""}`;

  const result = await invokeLLM({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    responseFormat: { type: "json_schema", json_schema: TAILORED_MATERIALS_SCHEMA },
  });

  const content = result.choices[0]?.message?.content;
  const raw = typeof content === "string" ? content : "";
  if (!raw) throw new Error("The document-tailoring step returned an empty response");

  return JSON.parse(raw) as TailoredMaterials;
}

/** Formats tailored materials as a single Telegram message. */
export function formatTailoredMaterialsMessage(job: { title: string; employer: string }, materials: TailoredMaterials): string {
  const highlights = materials.resumeHighlights.map(item => `• ${item}`).join("\n");
  const gaps = materials.gapsToMention.length
    ? `\n\nWorth knowing before you apply:\n${materials.gapsToMention.map(item => `• ${item}`).join("\n")}`
    : "";
  return `Tailored materials for ${job.title} at ${job.employer}\n\nResume highlights to lead with:\n${highlights}\n\nCover letter draft:\n${materials.coverLetter}${gaps}\n\nReview this yourself before using it — nothing here is submitted automatically.`;
}
