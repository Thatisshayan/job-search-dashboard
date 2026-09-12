import { describe, expect, it } from "vitest";
import { groupByEmployer, normalizeEmployerName, pickMostComplete } from "./crossSourceDedup";
import type { VerifiedListing } from "../verifiedListingImport";

describe("normalizeEmployerName", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmployerName("  Acme Corp  ")).toBe("acme");
  });

  it("strips common legal suffixes", () => {
    expect(normalizeEmployerName("Acme Inc.")).toBe("acme");
    expect(normalizeEmployerName("Acme LLC")).toBe("acme");
    expect(normalizeEmployerName("Acme Ltd")).toBe("acme");
    expect(normalizeEmployerName("Acme Corp")).toBe("acme");
    expect(normalizeEmployerName("Acme Co")).toBe("acme");
  });

  it("strips punctuation", () => {
    expect(normalizeEmployerName("Acme, Inc.")).toBe("acme");
  });

  it("returns an empty string for placeholder employer values, distinguishing them from a real empty name", () => {
    expect(normalizeEmployerName("Employer not disclosed")).toBe("");
  });
});

function listing(overrides: Partial<VerifiedListing> = {}): VerifiedListing {
  return {
    sourceName: "Adzuna",
    sourceExternalId: "1",
    sourcePostingUrl: "https://example.com/1",
    originalApplyUrl: "https://example.com/1",
    title: "Backend Engineer",
    employer: "Acme Corp",
    location: "Toronto, Ontario",
    employmentType: "full-time" as const,
    description: "A".repeat(100),
    postedAt: new Date("2026-09-01"),
    seniorityMatch: "partial" as const,
    verificationNote: "test",
    ...overrides,
  };
}

describe("groupByEmployer (cross-source only)", () => {
  it("only groups employers that have listings from more than one source", () => {
    const groups = groupByEmployer([
      listing({ sourceName: "Adzuna", employer: "Acme" }),
      listing({ sourceName: "Indeed", employer: "Acme" }),
      listing({ sourceName: "Adzuna", employer: "Widgets Inc" }),
    ]);
    expect(groups.get("acme")).toHaveLength(2);
    expect(groups.get("widgets")).toBeUndefined();
  });
});

describe("pickMostComplete", () => {
  it("prefers the listing with fewer placeholder fields", () => {
    const sparse = listing({ location: "Location not disclosed", description: "A".repeat(90) });
    const full = listing({ location: "Toronto, Ontario", description: "A".repeat(400) });
    expect(pickMostComplete([sparse, full])).toBe(full);
  });

  it("returns the only listing when the group has one", () => {
    const only = listing();
    expect(pickMostComplete([only])).toBe(only);
  });
});
