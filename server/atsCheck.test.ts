import { describe, expect, it } from "vitest";
import { evaluateExtractedText, assessPdfAtsParseability } from "./atsCheck";
import { buildTailoredResumePdf } from "./documentTailoring";

describe("evaluateExtractedText", () => {
  const realResumeText = `Jane Doe
Backend Software Engineer

Summary
Experienced backend engineer with a track record of shipping reliable services.

Experience
Senior Backend Engineer — Acme Corp
Shipped a payments service used by millions of users.`;

  it("passes real, well-formed resume text", () => {
    const result = evaluateExtractedText(realResumeText, "Jane Doe");
    expect(result.ok).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("flags text that's too short to be a real resume", () => {
    const result = evaluateExtractedText("Jane Doe", "Jane Doe");
    expect(result.ok).toBe(false);
    expect(result.reasons.some(reason => reason.includes("too short"))).toBe(true);
  });

  it("flags a high ratio of non-printable characters as garbled glyphs", () => {
    const garbled = "����".repeat(60);
    const result = evaluateExtractedText(garbled, "Jane Doe");
    expect(result.ok).toBe(false);
    expect(result.reasons.some(reason => reason.includes("garbled"))).toBe(true);
  });

  it("flags missing contact-info text when the candidate's name isn't found", () => {
    const result = evaluateExtractedText(realResumeText, "Someone Else Entirely");
    expect(result.ok).toBe(false);
    expect(result.reasons.some(reason => reason.includes("name wasn't found"))).toBe(true);
  });

  it("skips the name check when no expected name is given", () => {
    const result = evaluateExtractedText(realResumeText, "");
    expect(result.ok).toBe(true);
  });
});

describe("assessPdfAtsParseability (integration, real PDF)", () => {
  const profile = {
    displayName: "Jane Doe",
    headline: "Backend Software Engineer",
    location: "Montreal, Quebec",
    skills: { "programming languages": ["Go", "TypeScript"] },
    experience: [
      { employer: "Acme Corp", title: "Senior Backend Engineer", period: "2022-Present", evidence: ["Shipped a payments service"] },
    ],
    education: [{ degree: "B.Sc. Computer Science", institution: "University of Toronto", year: 2019 }],
  };
  const materials = {
    tailoredSummary: "A tailored summary with enough real content to pass the length check comfortably.",
    experienceBullets: [{ experienceIndex: 0, bullets: ["Tailored bullet describing real, verified work."] }],
    skillsToHighlight: ["Go", "TypeScript"],
    coverLetter: "Dear hiring manager, I am excited to apply.",
    gapsToMention: [],
  };

  it("confirms a real generated resume PDF extracts sanely, name included", async () => {
    const pdf = await buildTailoredResumePdf(profile, materials);
    const result = await assessPdfAtsParseability(pdf, profile.displayName);
    expect(result.ok).toBe(true);
  });
});
