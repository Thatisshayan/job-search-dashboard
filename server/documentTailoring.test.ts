import { describe, expect, it } from "vitest";
import { formatTailoredMaterialsMessage } from "./documentTailoring";

describe("formatTailoredMaterialsMessage", () => {
  it("includes the job title/employer, all highlights, the cover letter, and a manual-review reminder", () => {
    const message = formatTailoredMaterialsMessage(
      { title: "Backend Engineer", employer: "Acme Corp" },
      { resumeHighlights: ["Built a payments service", "Led a team of 3"], coverLetter: "Dear hiring manager, ...", gapsToMention: [] },
    );

    expect(message).toContain("Backend Engineer");
    expect(message).toContain("Acme Corp");
    expect(message).toContain("Built a payments service");
    expect(message).toContain("Led a team of 3");
    expect(message).toContain("Dear hiring manager");
    expect(message).toContain("nothing here is submitted automatically");
    expect(message).not.toContain("Worth knowing before you apply");
  });

  it("surfaces gapsToMention when present", () => {
    const message = formatTailoredMaterialsMessage(
      { title: "Backend Engineer", employer: "Acme Corp" },
      { resumeHighlights: ["Built APIs"], coverLetter: "Dear hiring manager, ...", gapsToMention: ["Job requires 8+ years; resume shows 5"] },
    );

    expect(message).toContain("Worth knowing before you apply");
    expect(message).toContain("Job requires 8+ years; resume shows 5");
  });
});
