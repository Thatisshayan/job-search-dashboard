import { describe, expect, it } from "vitest";
import { extractGreenhouseBoardToken, greenhouseBoardJobToVerifiedListing, greenhouseBoardSourceName, isValidGreenhouseBoardToken } from "./greenhouseBoard";

describe("extractGreenhouseBoardToken", () => {
  it("accepts a bare board token", () => {
    expect(extractGreenhouseBoardToken("acme")).toBe("acme");
    expect(extractGreenhouseBoardToken("  Acme-Corp  ")).toBe("acme-corp");
  });

  it("extracts the token from a full Greenhouse board URL, including deeper job-detail paths", () => {
    expect(extractGreenhouseBoardToken("https://boards.greenhouse.io/acme")).toBe("acme");
    expect(extractGreenhouseBoardToken("https://job-boards.greenhouse.io/acme/jobs/12345")).toBe("acme");
  });

  it("rejects non-Greenhouse URLs and malformed input", () => {
    expect(extractGreenhouseBoardToken("https://boards.lever.co/acme")).toBeNull();
    expect(extractGreenhouseBoardToken("https://example.com")).toBeNull();
    expect(extractGreenhouseBoardToken("")).toBeNull();
    expect(extractGreenhouseBoardToken("not a valid token!!")).toBeNull();
  });
});

describe("isValidGreenhouseBoardToken", () => {
  it("allows alphanumeric-and-hyphen tokens only", () => {
    expect(isValidGreenhouseBoardToken("acme-corp2")).toBe(true);
    expect(isValidGreenhouseBoardToken("acme corp")).toBe(false);
    expect(isValidGreenhouseBoardToken("")).toBe(false);
  });
});

describe("greenhouseBoardSourceName", () => {
  it("namespaces the source name per company so importVerifiedListingBatch's sourceConfigs lookup stays unique per watched board", () => {
    expect(greenhouseBoardSourceName("acme")).toBe("Greenhouse:acme");
  });
});

describe("greenhouseBoardJobToVerifiedListing", () => {
  const longDescription = "a".repeat(100);

  it("maps a real-shaped Greenhouse job into a VerifiedListing with the real, directly-usable apply URL", () => {
    const listing = greenhouseBoardJobToVerifiedListing(
      {
        id: 8599937002,
        title: "Backend Engineer",
        absolute_url: "https://job-boards.greenhouse.io/acme/jobs/8599937002",
        location: { name: "Toronto, Ontario" },
        content: `<p>${longDescription}</p>`,
        updated_at: "2026-08-01T00:00:00Z",
      },
      "Acme",
      "acme"
    );
    expect(listing).not.toBeNull();
    expect(listing?.sourceName).toBe("Greenhouse:acme");
    expect(listing?.originalApplyUrl).toBe("https://job-boards.greenhouse.io/acme/jobs/8599937002");
    expect(listing?.sourcePostingUrl).toBe(listing?.originalApplyUrl);
    expect(listing?.employer).toBe("Acme");
    expect(listing?.description).toContain("aaa");
  });

  it("decodes Greenhouse's double-HTML-escaped content field before stripping tags", () => {
    const listing = greenhouseBoardJobToVerifiedListing(
      {
        id: 1,
        title: "Role",
        absolute_url: "https://job-boards.greenhouse.io/acme/jobs/1",
        content: `&lt;div class=&quot;x&quot;&gt;&lt;p&gt;${longDescription}&lt;/p&gt;&lt;/div&gt;`,
      },
      "Acme",
      "acme"
    );
    expect(listing?.description).not.toContain("&lt;");
    expect(listing?.description).not.toContain("<div");
    expect(listing?.description).toContain("aaa");
  });

  it("rejects a job with no title, no apply URL, or too-short a description (matches Adzuna's own threshold)", () => {
    expect(greenhouseBoardJobToVerifiedListing({ id: 1, title: "", absolute_url: "https://x.greenhouse.io/1", content: longDescription }, "Acme", "acme")).toBeNull();
    expect(greenhouseBoardJobToVerifiedListing({ id: 1, title: "Role", absolute_url: "", content: longDescription }, "Acme", "acme")).toBeNull();
    expect(greenhouseBoardJobToVerifiedListing({ id: 1, title: "Role", absolute_url: "https://x.greenhouse.io/1", content: "too short" }, "Acme", "acme")).toBeNull();
  });
});
