import { describe, expect, it } from "vitest";
import { isGreenhouseApplyUrl } from "./greenhouse";

describe("isGreenhouseApplyUrl", () => {
  it("matches known Greenhouse job-board hostnames", () => {
    expect(isGreenhouseApplyUrl("https://boards.greenhouse.io/acme/jobs/12345")).toBe(true);
    expect(isGreenhouseApplyUrl("https://job-boards.greenhouse.io/acme/jobs/12345")).toBe(true);
    expect(isGreenhouseApplyUrl("https://acme.greenhouse.io/jobs/12345")).toBe(true);
  });

  it("rejects non-Greenhouse URLs and malformed input", () => {
    expect(isGreenhouseApplyUrl("https://boards.lever.co/acme/12345")).toBe(false);
    expect(isGreenhouseApplyUrl("https://example.com/apply")).toBe(false);
    expect(isGreenhouseApplyUrl(null)).toBe(false);
    expect(isGreenhouseApplyUrl(undefined)).toBe(false);
    expect(isGreenhouseApplyUrl("not a url")).toBe(false);
  });
});
