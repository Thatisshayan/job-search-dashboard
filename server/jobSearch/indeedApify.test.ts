import { describe, expect, it } from "vitest";
import { indeedJobToVerifiedListing, INDEED_SOURCE_NAME } from "./indeedApify";

const baseJob = {
  positionName: "Backend Software Engineer",
  description: "A".repeat(120),
  company: "Acme Corp",
  location: "Montreal, Quebec",
  url: "https://www.indeed.com/viewjob?jk=abc123",
  postedAt: "2026-09-01T12:00:00Z",
};

describe("indeedJobToVerifiedListing", () => {
  it("maps a real-shaped Indeed job into a verified listing", () => {
    const listing = indeedJobToVerifiedListing(baseJob);
    expect(listing).not.toBeNull();
    expect(listing?.sourceName).toBe(INDEED_SOURCE_NAME);
    // No documented stable `id` field on this actor's output — `url` is the external-id fallback.
    expect(listing?.sourceExternalId).toBe(baseJob.url);
    expect(listing?.originalApplyUrl).toBe(baseJob.url);
    expect(listing?.employmentType).toBe("full-time");
    expect(listing?.seniorityMatch).toBe("partial");
  });

  it("rejects listings with no title or apply URL", () => {
    expect(indeedJobToVerifiedListing({ ...baseJob, positionName: "" })).toBeNull();
    expect(indeedJobToVerifiedListing({ ...baseJob, url: "" })).toBeNull();
  });

  it("rejects listings with too little description", () => {
    expect(indeedJobToVerifiedListing({ ...baseJob, description: "Too short" })).toBeNull();
  });

  it("falls back to placeholder text for missing company/location", () => {
    const listing = indeedJobToVerifiedListing({ ...baseJob, company: undefined, location: undefined });
    expect(listing?.employer).toBe("Employer not disclosed");
    expect(listing?.location).toBe("Location not disclosed");
  });

  it("falls back to the current date when postedAt is missing", () => {
    const listing = indeedJobToVerifiedListing({ ...baseJob, postedAt: undefined });
    expect(listing?.postedAt).toBeInstanceOf(Date);
  });
});
