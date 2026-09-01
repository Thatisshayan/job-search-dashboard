import PDFDocument from "pdfkit";
import { invokeLLM } from "./_core/llm";
import type { CandidateProfile } from "../drizzle/schema";

const TAILORED_MATERIALS_SCHEMA = {
  name: "tailored_application_materials",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["tailoredSummary", "experienceBullets", "skillsToHighlight", "coverLetter", "gapsToMention"],
    properties: {
      tailoredSummary: {
        type: "string",
        description: "A 2-4 sentence professional summary tailored to this specific job, using only facts from the candidate profile provided.",
      },
      experienceBullets: {
        type: "array",
        description: "For each experience entry worth featuring, rewritten/reordered bullet points emphasizing what's relevant to this job. Reference entries by their zero-based index in the profile's experience array — never invent an entry that isn't in the list.",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["experienceIndex", "bullets"],
          properties: {
            experienceIndex: { type: "number" },
            bullets: { type: "array", items: { type: "string" } },
          },
        },
      },
      skillsToHighlight: {
        type: "array",
        description: "Skills to foreground for this job. Must be copied verbatim from the candidate profile's skills — never a skill not present there.",
        items: { type: "string" },
      },
      coverLetter: {
        type: "string",
        description: "A concise (3-4 short paragraphs) cover letter body (no salutation/signature — those are added separately), addressed to the employer, referencing the specific job title and grounded only in the candidate's real experience/skills.",
      },
      gapsToMention: {
        type: "array",
        description: "Any material qualification gaps between the job and the candidate's verified experience (e.g. a licence or years of experience the resume doesn't establish). Empty array if none.",
        items: { type: "string" },
      },
    },
  },
  strict: true,
} as const;

const SYSTEM_PROMPT = `You tailor a candidate's real resume content and write a cover letter for a specific job posting.

Hard rules:
- Use ONLY facts present in the candidate profile provided below (employers, titles, dates, skills, education). Never invent or infer licensure, certifications, work authorization, years of experience, or achievements not stated.
- Reference experience entries only by the index they appear at in the profile — do not merge, invent, or reorder entries; only rewrite/select bullets within each.
- Omit an experience entry from experienceBullets entirely if it is not relevant to this job — a candidate profile may deliberately include experience irrelevant to the roles they're now targeting, and this document must not surface it. Do not include an entry "just in case."
- Only list skills that are copied verbatim from the profile's skills.
- Do not exaggerate seniority or scope beyond what the profile states.
- If the job appears to require something the profile doesn't establish, note it in gapsToMention instead of glossing over it or omitting it silently.
- The cover letter must be professional, specific to this employer/title, and free of generic filler — every sentence should trace back to a real fact in the profile.`;

type RawTailoredMaterials = {
  tailoredSummary: string;
  experienceBullets: Array<{ experienceIndex: number; bullets: string[] }>;
  skillsToHighlight: string[];
  coverLetter: string;
  gapsToMention: string[];
};

export type TailoredMaterials = RawTailoredMaterials & { gapsToMention: string[] };

type ProfileForTailoring = Pick<CandidateProfile, "displayName" | "headline" | "location" | "skills" | "experience" | "education">;

function flattenSkills(skills: Record<string, string[]>): string[] {
  return Object.values(skills).flat();
}

/**
 * Generates tailored materials, then validates the LLM's output against the
 * real profile before trusting it — belt and suspenders on top of the prompt
 * rules, since experienceIndex/skillsToHighlight are used to assemble the
 * actual resume document afterward and must never reference something that
 * isn't real.
 */
export async function generateTailoredMaterials(input: {
  profile: ProfileForTailoring;
  job: { title: string; employer: string; description: string };
  scoreRationale?: string;
}): Promise<TailoredMaterials> {
  const profileText = JSON.stringify(
    {
      name: input.profile.displayName,
      headline: input.profile.headline,
      skills: input.profile.skills,
      experience: input.profile.experience.map((entry, index) => ({ index, ...entry })),
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
  const parsed = JSON.parse(raw) as RawTailoredMaterials;

  const validIndexes = new Set(input.profile.experience.map((_, index) => index));
  const realSkills = new Set(flattenSkills(input.profile.skills));

  return {
    ...parsed,
    experienceBullets: parsed.experienceBullets.filter(entry => validIndexes.has(entry.experienceIndex)),
    skillsToHighlight: parsed.skillsToHighlight.filter(skill => realSkills.has(skill)),
  };
}

/**
 * Only entries the model chose to feature (present in experienceBullets)
 * get rendered — that's what makes an irrelevant entry actually get
 * dropped instead of appearing with its original, untailored bullets.
 * Falls back to every entry, in original order, only if the model returned
 * no selections at all (an LLM/parsing failure), so a real failure can't
 * silently produce an empty resume.
 */
export function selectFeaturedExperienceIndexes(experienceCount: number, experienceBullets: Array<{ experienceIndex: number }>): number[] {
  const allIndexes = Array.from({ length: experienceCount }, (_, index) => index);
  if (!experienceBullets.length) return allIndexes;
  const featured = new Set(experienceBullets.map(entry => entry.experienceIndex));
  return allIndexes.filter(index => featured.has(index));
}

function newPdfDoc(): PDFKit.PDFDocument {
  return new PDFDocument({ margin: 54, size: "LETTER" });
}

async function bufferFromDoc(doc: PDFKit.PDFDocument): Promise<Buffer> {
  const chunks: Buffer[] = [];
  doc.on("data", chunk => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.end();
  return done;
}

/**
 * Builds a complete, ready-to-send resume PDF: real name/headline/education
 * from the profile, tailored summary and per-entry bullets from the LLM
 * (falling back to the entry's original evidence if the LLM didn't cover it),
 * in the same order the entries appear in the real profile.
 */
export async function buildTailoredResumePdf(profile: ProfileForTailoring, materials: TailoredMaterials): Promise<Buffer> {
  const doc = newPdfDoc();
  const bulletsByIndex = new Map(materials.experienceBullets.map(entry => [entry.experienceIndex, entry.bullets]));

  doc.fontSize(20).font("Helvetica-Bold").text(profile.displayName || "Resume");
  doc.fontSize(12).font("Helvetica").fillColor("#444").text(profile.headline || "");
  if (profile.location) doc.text(profile.location);
  doc.moveDown();

  if (materials.tailoredSummary) {
    doc.fontSize(13).font("Helvetica-Bold").fillColor("#000").text("Summary");
    doc.fontSize(11).font("Helvetica").text(materials.tailoredSummary);
    doc.moveDown();
  }

  const skills = materials.skillsToHighlight.length ? materials.skillsToHighlight : flattenSkills(profile.skills).slice(0, 12);
  if (skills.length) {
    doc.fontSize(13).font("Helvetica-Bold").text("Skills");
    doc.fontSize(11).font("Helvetica").text(skills.join(" • "));
    doc.moveDown();
  }

  const featuredIndexes = selectFeaturedExperienceIndexes(profile.experience.length, materials.experienceBullets);

  if (featuredIndexes.length) {
    doc.fontSize(13).font("Helvetica-Bold").text("Experience");
    doc.moveDown(0.3);
    featuredIndexes.forEach(index => {
      const entry = profile.experience[index];
      const title = String(entry.title ?? "");
      const employer = String(entry.employer ?? "");
      const period = String(entry.period ?? "");
      doc.fontSize(11).font("Helvetica-Bold").text(`${title}${title && employer ? " — " : ""}${employer}`);
      if (period) doc.fontSize(10).font("Helvetica-Oblique").fillColor("#555").text(period);
      const bullets = bulletsByIndex.get(index) ?? (Array.isArray(entry.evidence) ? (entry.evidence as string[]) : []);
      doc.fontSize(11).font("Helvetica").fillColor("#000");
      bullets.forEach(bullet => doc.text(`• ${bullet}`, { indent: 12 }));
      doc.moveDown(0.6);
    });
  }

  if (profile.education.length) {
    doc.fontSize(13).font("Helvetica-Bold").text("Education");
    doc.fontSize(11).font("Helvetica");
    profile.education.forEach(entry => {
      const degree = String(entry.degree ?? "");
      const institution = String(entry.institution ?? "");
      const year = entry.year ? String(entry.year) : "";
      doc.text([degree, institution, year].filter(Boolean).join(" — "));
    });
  }

  return bufferFromDoc(doc);
}

export type ShortlistSummaryRow = {
  rank: number;
  score: number;
  title: string;
  employer: string;
  location: string;
  originalApplyUrl: string | null;
};

/**
 * A one-page overview of the whole day's shortlist, sent before the
 * individual per-job approval cards, so the candidate can scan everything
 * at once instead of only ever seeing one job at a time.
 */
export async function buildShortlistSummaryPdf(input: { candidateName: string; dateKey: string; rows: ShortlistSummaryRow[] }): Promise<Buffer> {
  const doc = newPdfDoc();

  doc.fontSize(18).font("Helvetica-Bold").text(`Job shortlist — ${input.dateKey}`);
  doc.fontSize(11).font("Helvetica").fillColor("#444").text(input.candidateName || "");
  doc.moveDown();
  doc.fontSize(10).fillColor("#666").text("Approve/Decline buttons for each of these follow as separate messages below.");
  doc.moveDown();

  input.rows.forEach(row => {
    doc.fontSize(12).font("Helvetica-Bold").fillColor("#000").text(`${row.rank}. ${row.title} — ${row.score}/100`);
    doc.fontSize(11).font("Helvetica").fillColor("#333").text(`${row.employer} · ${row.location}`);
    if (row.originalApplyUrl) {
      doc.fontSize(10).fillColor("#0645AD").text(row.originalApplyUrl, { link: row.originalApplyUrl, underline: true });
    }
    doc.fillColor("#000");
    doc.moveDown(0.7);
  });

  return bufferFromDoc(doc);
}

export async function buildCoverLetterPdf(profile: ProfileForTailoring, job: { title: string; employer: string }, materials: TailoredMaterials): Promise<Buffer> {
  const doc = newPdfDoc();
  const today = new Intl.DateTimeFormat("en-CA", { dateStyle: "long" }).format(new Date());

  doc.fontSize(11).font("Helvetica").text(profile.displayName || "");
  doc.text(today);
  doc.moveDown();
  doc.text(`Re: Application for ${job.title} at ${job.employer}`);
  doc.moveDown();
  doc.text("Dear Hiring Manager,");
  doc.moveDown();
  doc.text(materials.coverLetter, { align: "left" });
  doc.moveDown();
  doc.text("Sincerely,");
  doc.text(profile.displayName || "");

  return bufferFromDoc(doc);
}
