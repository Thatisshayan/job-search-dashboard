import { invokeLLM } from "../_core/llm";
import { downloadTelegramFile } from "../telegram";
import type { ParsedResumeProfile } from "./db";

export type SupportedResumeMime = "application/pdf" | "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export function isSupportedResumeMime(mimeType: string | undefined): mimeType is SupportedResumeMime {
  return mimeType === "application/pdf" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
}

async function extractText(buffer: Buffer, mimeType: SupportedResumeMime): Promise<string> {
  if (mimeType === "application/pdf") {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);
    return result.text;
  }
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

// Skills are modeled as a fixed array-of-objects (category + items) rather than a
// dictionary with arbitrary keys — OpenAI-style strict structured outputs don't
// reliably support open-ended `additionalProperties` schemas, but do support a
// fixed shape like this. Converted to the Record<string, string[]> shape
// `candidateProfiles.skills` expects in `parseResumeText` below.
const PROFILE_JSON_SCHEMA = {
  name: "resume_profile",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["displayName", "headline", "location", "summary", "skills", "experience", "education"],
    properties: {
      displayName: { type: "string" },
      headline: { type: "string" },
      location: { type: "string" },
      summary: { type: "string" },
      skills: {
        type: "array",
        description: "Group specific skills found verbatim or clearly implied in the resume by category (e.g. 'technical', 'coordination').",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["category", "items"],
          properties: {
            category: { type: "string" },
            items: { type: "array", items: { type: "string" } },
          },
        },
      },
      experience: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["employer", "title", "period", "evidence"],
          properties: {
            employer: { type: "string" },
            title: { type: "string" },
            period: { type: "string" },
            evidence: { type: "array", items: { type: "string" } },
          },
        },
      },
      education: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["degree", "institution", "year"],
          properties: {
            degree: { type: "string" },
            institution: { type: "string" },
            // Nullable rather than omitted: strict JSON-schema mode requires every
            // property to be listed in `required`, but a resume often doesn't state
            // a graduation year — null lets the model say "not stated" instead of
            // being forced to guess or default to something like 0.
            year: { type: ["number", "null"] },
          },
        },
      },
    },
  },
  strict: true,
} as const;

const SYSTEM_PROMPT = `You extract structured candidate profile data from resume text.
Only include facts that are stated or directly evidenced in the resume text.
Never invent licensure, work authorization, certifications, employers, titles, or dates that are not present.
If a field cannot be determined from the text, use an empty string, empty array, empty object, or null (for numbers like a graduation year) as appropriate — do not guess.`;

/**
 * Turns raw resume text into the structured shape `candidateProfiles` expects.
 * This is the one place resume facts get interpreted — kept deliberately
 * conservative (matches the existing "never infer credentials" guardrail
 * philosophy already in server/db.ts's seed data).
 */
type RawParsedProfile = Omit<ParsedResumeProfile, "resumeLabel" | "skills"> & {
  skills: Array<{ category: string; items: string[] }>;
};

export async function parseResumeText(resumeText: string): Promise<Omit<ParsedResumeProfile, "resumeLabel">> {
  const result = await invokeLLM({
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: resumeText.slice(0, 20_000) },
    ],
    responseFormat: { type: "json_schema", json_schema: PROFILE_JSON_SCHEMA },
  });

  const content = result.choices[0]?.message?.content;
  const raw = typeof content === "string" ? content : "";
  if (!raw) throw new Error("The resume parser returned an empty response");

  const parsed = JSON.parse(raw) as RawParsedProfile;
  const skills: Record<string, string[]> = {};
  for (const group of parsed.skills) {
    if (group.category) skills[group.category] = group.items;
  }

  return { ...parsed, skills };
}

export async function downloadAndParseResume(fileId: string, mimeType: SupportedResumeMime, resumeLabel: string): Promise<ParsedResumeProfile> {
  const buffer = await downloadTelegramFile(fileId);
  const text = await extractText(buffer, mimeType);
  if (text.trim().length < 50) {
    throw new Error("Could not read enough text from that file — is it a text-based PDF/DOCX (not a scanned image)?");
  }
  const parsed = await parseResumeText(text);
  return { ...parsed, resumeLabel };
}
