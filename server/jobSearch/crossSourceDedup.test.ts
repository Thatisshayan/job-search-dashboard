import { describe, expect, it } from "vitest";
import { normalizeEmployerName } from "./crossSourceDedup";

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
