import { describe, expect, it } from "vitest";
import { indeedJobToVerifiedListing, INDEED_SOURCE_NAME } from "./indeedApify";

const baseJob = {
  id: "510aa06d1dc51b46",
  title: { text: "Backend Software Engineer" },
  description: { text: "A".repeat(120) },
  company: { name: "Acme Corp" },
  location: { formatted: "Toronto, ON" },
  apply: { url: "https://jobs.example.com/apply/abc123" },
  dates: { posted: "2026-09-01" },
};

describe("indeedJobToVerifiedListing", () => {
  it("maps a real-shaped Indeed job into a verified listing", () => {
    const listing = indeedJobToVerifiedListing(baseJob);
    expect(listing).not.toBeNull();
    expect(listing?.sourceName).toBe(INDEED_SOURCE_NAME);
    expect(listing?.sourceExternalId).toBe(baseJob.id);
    expect(listing?.originalApplyUrl).toBe(baseJob.apply.url);
    expect(listing?.employmentType).toBe("full-time");
    expect(listing?.seniorityMatch).toBe("partial");
  });

  it("falls back to urls.apply when the flat apply.url field is absent", () => {
    const listing = indeedJobToVerifiedListing({ ...baseJob, apply: undefined, urls: { apply: "https://jobs.example.com/apply/xyz" } });
    expect(listing?.originalApplyUrl).toBe("https://jobs.example.com/apply/xyz");
  });

  it("rejects listings with no id, no title, or no apply url", () => {
    expect(indeedJobToVerifiedListing({ ...baseJob, id: undefined })).toBeNull();
    expect(indeedJobToVerifiedListing({ ...baseJob, title: undefined })).toBeNull();
    expect(indeedJobToVerifiedListing({ ...baseJob, apply: undefined, urls: undefined })).toBeNull();
  });

  it("rejects listings with too little description", () => {
    expect(indeedJobToVerifiedListing({ ...baseJob, description: { text: "Too short" } })).toBeNull();
  });

  it("falls back to placeholder text for missing company/location", () => {
    const listing = indeedJobToVerifiedListing({ ...baseJob, company: undefined, location: undefined });
    expect(listing?.employer).toBe("Employer not disclosed");
    expect(listing?.location).toBe("Location not disclosed");
  });

  it("falls back to the current date when dates.posted is missing", () => {
    const listing = indeedJobToVerifiedListing({ ...baseJob, dates: undefined });
    expect(listing?.postedAt).toBeInstanceOf(Date);
  });
});
