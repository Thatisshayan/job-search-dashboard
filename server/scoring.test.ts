import { describe, expect, it } from "vitest";
import { SCORE_WEIGHTS, scoreJob } from "./scoring";

describe("scoreJob", () => {
  it("preserves the six required component weights for a strong active in-radius full-time match", () => {
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
      targetTitles: ["Construction Project Manager"],
      targetCity: "Toronto, Ontario",
      targetRadiusKm: 75,
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

  it("works identically for a non-construction role — the engine is not hardcoded to any industry", () => {
    const result = scoreJob({
      title: "Backend Software Engineer",
      description: "A detailed backend engineering role building distributed systems, APIs, and data pipelines with strong ownership of production reliability.".repeat(3),
      employmentType: "Full-time",
      location: "Montreal, Quebec",
      originalApplyUrl: "https://employer.example/apply",
      postedAt: new Date(),
      status: "active",
      skillMatches: ["Go", "TypeScript", "PostgreSQL", "Kafka", "Docker"],
      seniorityMatch: "strong",
      targetTitles: ["Backend Software Engineer", "Backend Developer"],
      targetCity: "Montreal, Quebec",
      targetRadiusKm: 25,
    });

    expect(result.roleAlignment).toBe(SCORE_WEIGHTS.roleAlignment);
    expect(result.locationCommuteFit).toBe(SCORE_WEIGHTS.locationCommuteFit);
    expect(result.totalScore).toBe(100);
  });

  it("applies penalties for missing apply links, non-full-time roles, out-of-radius locations, expired listings, and duplicates", () => {
    const result = scoreJob({
      title: "Estimator",
      description: "Short listing",
      employmentType: "Contract",
      location: "Ottawa, Ontario",
      status: "expired",
      isDuplicate: true,
      seniorityMatch: "weak",
      targetTitles: ["Estimator"],
      targetCity: "Toronto, Ontario",
      targetRadiusKm: 75,
    });

    expect(result.penalties).toBe(-120);
    expect(result.totalScore).toBe(0);
    expect(result.notableGaps).toHaveLength(5);
  });

  it("gives zero role alignment when no target titles are configured", () => {
    const result = scoreJob({
      title: "Construction Manager",
      description: "A full-time role with schedules, subcontractors, budgets, contracts, and quality control.",
      employmentType: "Full-time",
      location: "Markham, Ontario",
      originalApplyUrl: "https://employer.example/apply",
      postedAt: new Date(),
      skillMatches: ["subcontractor management"],
      seniorityMatch: "partial",
    });

    expect(result.roleAlignment).toBe(0);
  });

  it("treats a title sharing two or more significant words with a target title as related", () => {
    const result = scoreJob({
      title: "Junior Construction Site Coordinator",
      description: "A full-time coordination role.",
      employmentType: "Full-time",
      location: "Concord, Ontario",
      originalApplyUrl: "https://employer.example/apply",
      postedAt: new Date(),
      seniorityMatch: "partial",
      targetTitles: ["Construction Coordinator"],
      targetCity: "Toronto, Ontario",
      targetRadiusKm: 75,
    });

    expect(result.roleAlignment).toBe(18);
  });

  it("uses a real distance (locationKm) over the target-city text fallback when both are available", () => {
    const withinRadius = scoreJob({
      title: "Estimator",
      description: "A role.",
      location: "Some Town",
      locationKm: 40,
      targetTitles: ["Estimator"],
      targetCity: "Toronto, Ontario",
      targetRadiusKm: 50,
    });
    const outsideRadius = scoreJob({
      title: "Estimator",
      description: "A role.",
      location: "Toronto, Ontario", // text would match, but the real distance doesn't
      locationKm: 120,
      targetTitles: ["Estimator"],
      targetCity: "Toronto, Ontario",
      targetRadiusKm: 50,
    });

    expect(withinRadius.locationCommuteFit).toBe(SCORE_WEIGHTS.locationCommuteFit);
    expect(outsideRadius.locationCommuteFit).toBe(0);
  });
});
