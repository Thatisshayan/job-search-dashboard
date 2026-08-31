import { describe, expect, it } from "vitest";
import { isSupportedResumeMime } from "./resumeParsing";

describe("isSupportedResumeMime", () => {
  it("accepts PDF and DOCX mime types", () => {
    expect(isSupportedResumeMime("application/pdf")).toBe(true);
    expect(isSupportedResumeMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
  });

  it("rejects everything else, including undefined", () => {
    expect(isSupportedResumeMime("image/png")).toBe(false);
    expect(isSupportedResumeMime("application/msword")).toBe(false);
    expect(isSupportedResumeMime(undefined)).toBe(false);
  });
});
