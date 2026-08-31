import { describe, expect, it, vi } from "vitest";
import { generateTailoredMaterials, buildTailoredResumePdf, buildCoverLetterPdf } from "./documentTailoring";

const invokeLLM = vi.fn();
vi.mock("./_core/llm", () => ({ invokeLLM: (...args: unknown[]) => invokeLLM(...args) }));

const profile = {
  displayName: "Jane Doe",
  headline: "Backend Software Engineer",
  location: "Montreal, Quebec",
  skills: { "programming languages": ["Go", "TypeScript"], databases: ["PostgreSQL"] },
  experience: [
    { employer: "Acme Corp", title: "Senior Backend Engineer", period: "2022-Present", evidence: ["Shipped a payments service"] },
    { employer: "Widgets Inc", title: "Backend Engineer", period: "2019-2022", evidence: ["Built REST APIs"] },
  ],
  education: [{ degree: "B.Sc. Computer Science", institution: "University of Toronto", year: 2019 }],
};

const job = { title: "Backend Engineer", employer: "New Co", description: "Build backend services." };

function mockLlmResponse(payload: unknown) {
  invokeLLM.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(payload) } }] });
}

describe("generateTailoredMaterials", () => {
  it("keeps valid experience indexes and skills, and passes through the rest", async () => {
    mockLlmResponse({
      tailoredSummary: "A summary.",
      experienceBullets: [{ experienceIndex: 0, bullets: ["Tailored bullet"] }],
      skillsToHighlight: ["Go"],
      coverLetter: "Dear hiring manager...",
      gapsToMention: [],
    });

    const materials = await generateTailoredMaterials({ profile, job });
    expect(materials.experienceBullets).toEqual([{ experienceIndex: 0, bullets: ["Tailored bullet"] }]);
    expect(materials.skillsToHighlight).toEqual(["Go"]);
    expect(materials.tailoredSummary).toBe("A summary.");
  });

  it("drops an out-of-range experienceIndex and a hallucinated skill not in the real profile", async () => {
    mockLlmResponse({
      tailoredSummary: "A summary.",
      experienceBullets: [
        { experienceIndex: 0, bullets: ["Real entry"] },
        { experienceIndex: 99, bullets: ["Invented entry"] },
      ],
      skillsToHighlight: ["Go", "Quantum Computing"],
      coverLetter: "Dear hiring manager...",
      gapsToMention: [],
    });

    const materials = await generateTailoredMaterials({ profile, job });
    expect(materials.experienceBullets).toEqual([{ experienceIndex: 0, bullets: ["Real entry"] }]);
    expect(materials.skillsToHighlight).toEqual(["Go"]);
  });
});

describe("PDF generation", () => {
  const materials = {
    tailoredSummary: "A tailored summary.",
    experienceBullets: [{ experienceIndex: 0, bullets: ["Tailored bullet"] }],
    skillsToHighlight: ["Go", "TypeScript"],
    coverLetter: "Dear hiring manager, I am excited to apply.",
    gapsToMention: [],
  };

  it("builds a real PDF resume buffer", async () => {
    const buffer = await buildTailoredResumePdf(profile, materials);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("builds a real PDF cover letter buffer", async () => {
    const buffer = await buildCoverLetterPdf(profile, job, materials);
    expect(buffer.subarray(0, 4).toString()).toBe("%PDF");
    expect(buffer.length).toBeGreaterThan(500);
  });
});
