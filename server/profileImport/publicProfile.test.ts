import { describe, expect, it } from "vitest";
import { isSupportedProfileUrl } from "./publicProfile";

describe("isSupportedProfileUrl", () => {
  it("matches public LinkedIn profile URLs", () => {
    expect(isSupportedProfileUrl("https://www.linkedin.com/in/jane-doe/")).toBe(true);
    expect(isSupportedProfileUrl("https://linkedin.com/in/jane-doe")).toBe(true);
    expect(isSupportedProfileUrl("https://ca.linkedin.com/in/jane-doe")).toBe(true);
  });

  it("matches Indeed profile/resume URLs", () => {
    expect(isSupportedProfileUrl("https://www.indeed.com/r/jane-doe/abc123")).toBe(true);
    expect(isSupportedProfileUrl("https://profile.indeed.com/resume/abc123")).toBe(true);
  });

  it("rejects a LinkedIn URL that isn't a profile page", () => {
    expect(isSupportedProfileUrl("https://www.linkedin.com/jobs/view/12345")).toBe(false);
    expect(isSupportedProfileUrl("https://www.linkedin.com/company/acme")).toBe(false);
  });

  it("rejects unrelated hosts and malformed input", () => {
    expect(isSupportedProfileUrl("https://example.com/in/jane-doe")).toBe(false);
    expect(isSupportedProfileUrl("https://evil-linkedin.com.attacker.net/in/jane-doe")).toBe(false);
    expect(isSupportedProfileUrl(null)).toBe(false);
    expect(isSupportedProfileUrl(undefined)).toBe(false);
    expect(isSupportedProfileUrl("not a url")).toBe(false);
    expect(isSupportedProfileUrl("")).toBe(false);
  });
});
