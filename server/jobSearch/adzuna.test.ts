import { describe, expect, it } from "vitest";
import { adzunaJobToVerifiedListing } from "./adzuna";

const baseJob = {
  id: "12345",
  title: "Backend Software Engineer",
  description: "A".repeat(120),
  company: { display_name: "Acme Corp" },
  location: { display_name: "Montreal, Quebec" },
  contract_time: "full_time" as const,
  created: "2026-08-30T12:00:00Z",
  redirect_url: "https://www.adzuna.ca/details/12345",
};

describe("adzunaJobToVerifiedListing", () => {
  it("maps a full-time job with enough description into a verified listing", () => {
    const listing = adzunaJobToVerifiedListing(baseJob);
    expect(listing).not.toBeNull();
    expect(listing?.sourceName).toBe("Adzuna");
    expect(listing?.sourceExternalId).toBe("12345");
    expect(listing?.employmentType).toBe("full-time");
    expect(listing?.originalApplyUrl).toBe(baseJob.redirect_url);
    expect(listing?.seniorityMatch).toBe("partial");
    expect(listing?.verificationNote.length).toBeGreaterThanOrEqual(20);
  });

  it("rejects part-time listings", () => {
    expect(adzunaJobToVerifiedListing({ ...baseJob, contract_time: "part_time" })).toBeNull();
  });

  it("rejects listings with too little description to satisfy the import schema", () => {
    expect(adzunaJobToVerifiedListing({ ...baseJob, description: "Too short" })).toBeNull();
  });

  it("rejects listings with no redirect/apply URL", () => {
    expect(adzunaJobToVerifiedListing({ ...baseJob, redirect_url: "" })).toBeNull();
  });

  it("falls back to placeholder text for missing company/location", () => {
    const listing = adzunaJobToVerifiedListing({ ...baseJob, company: undefined, location: undefined });
    expect(listing?.employer).toBe("Employer not disclosed");
    expect(listing?.location).toBe("Location not disclosed");
  });
});
