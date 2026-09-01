import { describe, expect, it } from "vitest";
import { findVerifiedSkillMatches, getTorontoDateKey } from "./verifiedListingImport";

describe("verified listing import helpers", () => {
  it("matches a candidate's real skills against the listing text, for any domain", () => {
    const matches = findVerifiedSkillMatches(
      "We need someone strong in Kubernetes and PostgreSQL who can also mentor junior engineers.",
      ["Kubernetes", "PostgreSQL", "Go", "Blueprint reading"]
    );
    expect(matches).toEqual(expect.arrayContaining(["Kubernetes", "PostgreSQL"]));
    expect(matches).not.toContain("Go");
    expect(matches).not.toContain("Blueprint reading");
  });

  it("still matches construction-domain skills when they're genuinely the candidate's own", () => {
    const matches = findVerifiedSkillMatches(
      "Coordinate subcontractors, prepare construction schedules and milestones, manage budgets.",
      ["subcontractors", "budgets", "Kubernetes"]
    );
    expect(matches).toEqual(expect.arrayContaining(["subcontractors", "budgets"]));
    expect(matches).not.toContain("Kubernetes");
  });

  it("word-boundary guards short skill names so they don't false-match inside unrelated words", () => {
    const matches = findVerifiedSkillMatches("This role is about background checks and going the extra mile.", ["Go", "R"]);
    expect(matches).toEqual([]);
  });

  it("ignores empty or whitespace-only skill entries", () => {
    expect(findVerifiedSkillMatches("Some description", ["", "   "])).toEqual([]);
  });

  it("uses Toronto local dates for daily shortlist publication", () => {
    expect(getTorontoDateKey(new Date("2026-08-21T02:30:00.000Z"))).toBe("2026-08-20");
  });
});
