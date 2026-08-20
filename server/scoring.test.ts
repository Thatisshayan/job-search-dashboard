import { describe, expect, it } from "vitest";
import { SCORE_WEIGHTS, scoreJob } from "./scoring";

describe("scoreJob", () => {
  it("preserves the six required component weights for a strong active GTA full-time match", () => {
    const result = scoreJob({
      title: "Construction Project Manager",
      description: "A detailed construction project management role with permit coordination, OBC compliance, subcontractor management, drawing review, scheduling, budget tracking, quality control, and municipal inspections.".repeat(3),
      employmentType: "Full-time",
      location: "Toronto, Ontario",
      originalApplyUrl: "https://employer.example/apply",
      postedAt: new Date(),
      status: "active",
      skillMatches: ["permit coordination", "OBC compliance", "subcontractor management", "trade scheduling", "budget tracking"],
      seniorityMatch: "strong",
    });

    expect(result.roleAlignment).toBe(SCORE_WEIGHTS.roleAlignment);
    expect(result.resumeSkillMatch).toBe(SCORE_WEIGHTS.resumeSkillMatch);
    expect(result.seniorityAlignment).toBe(SCORE_WEIGHTS.seniorityAlignment);
    expect(result.locationCommuteFit).toBe(SCORE_WEIGHTS.locationCommuteFit);
    expect(result.employmentQualityFit).toBe(SCORE_WEIGHTS.employmentQualityFit);
    expect(result.recencyReadiness).toBe(SCORE_WEIGHTS.recencyReadiness);
    expect(result.penalties).toBe(0);
    expect(result.totalScore).toBe(100);
  });

  it("applies penalties for missing apply links, non-full-time roles, non-GTA locations, expired listings, and duplicates", () => {
    const result = scoreJob({
      title: "Estimator",
      description: "Short listing",
      employmentType: "Contract",
      location: "Ottawa, Ontario",
      status: "expired",
      isDuplicate: true,
      seniorityMatch: "weak",
    });

    expect(result.penalties).toBe(-120);
    expect(result.totalScore).toBe(0);
    expect(result.notableGaps).toHaveLength(5);
  });

  it("treats construction-manager titles as a direct adjacent role family", () => {
    const result = scoreJob({
      title: "Construction Manager",
      description: "A full-time GTA construction-management role with schedules, subcontractors, budgets, contracts, and quality control.",
      employmentType: "Full-time",
      location: "Markham, Ontario",
      originalApplyUrl: "https://employer.example/apply",
      postedAt: new Date(),
      skillMatches: ["subcontractor management"],
      seniorityMatch: "partial",
    });

    expect(result.roleAlignment).toBe(SCORE_WEIGHTS.roleAlignment);
  });

  it("accepts Canadian coordinator spelling variants as direct target roles", () => {
    const result = scoreJob({
      title: "Project Co-ordinator, Construction",
      description: "A full-time GTA construction coordination role.",
      employmentType: "Full-time",
      location: "Concord, Ontario",
      originalApplyUrl: "https://employer.example/apply",
      postedAt: new Date(),
      seniorityMatch: "partial",
    });

    expect(result.roleAlignment).toBe(SCORE_WEIGHTS.roleAlignment);
  });
});
