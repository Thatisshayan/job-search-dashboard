import { describe, expect, it } from "vitest";
import { findVerifiedSkillMatches, getTorontoDateKey } from "./verifiedListingImport";

describe("verified listing import helpers", () => {
  it("only identifies resume skills that have direct evidence in the verified listing text", () => {
    const matches = findVerifiedSkillMatches("Coordinate subcontractors, prepare construction schedules and milestones, manage budgets, negotiate contracts, and establish quality control procedures.");
    expect(matches).toEqual(expect.arrayContaining(["subcontractor management", "multi-site scheduling", "budget tracking", "contract negotiation", "quality control"]));
    expect(matches).not.toContain("Ontario Building Code knowledge");
  });

  it("uses Toronto local dates for daily shortlist publication", () => {
    expect(getTorontoDateKey(new Date("2026-08-21T02:30:00.000Z"))).toBe("2026-08-20");
  });
});
