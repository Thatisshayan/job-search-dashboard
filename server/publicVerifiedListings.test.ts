import { describe, expect, it } from "vitest";
import { PUBLIC_VERIFIED_LISTINGS } from "./publicVerifiedListings";

describe("public verified listing bootstrap", () => {
  it("contains only full-time official Job Bank records with original application pages", () => {
    expect(PUBLIC_VERIFIED_LISTINGS).toHaveLength(10);
    for (const listing of PUBLIC_VERIFIED_LISTINGS) {
      expect(listing.sourceName).toBe("Government of Canada Job Bank");
      expect(listing.employmentType).toBe("full-time");
      expect(listing.originalApplyUrl).toMatch(/^https:\/\/www\.jobbank\.gc\.ca\/jobsearch\/jobposting\//);
    }
  });
});
