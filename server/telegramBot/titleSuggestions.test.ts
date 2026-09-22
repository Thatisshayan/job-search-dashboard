import { describe, expect, it } from "vitest";
import { dedupeTitles } from "./titleSuggestions";

describe("dedupeTitles", () => {
  it("trims whitespace and drops empty entries", () => {
    expect(dedupeTitles(["  Construction Project Manager  ", "", "   "])).toEqual([
      "Construction Project Manager",
    ]);
  });

  it("deduplicates case-insensitively, keeping the first casing seen", () => {
    expect(dedupeTitles(["Backend Engineer", "backend engineer", "BACKEND ENGINEER"])).toEqual([
      "Backend Engineer",
    ]);
  });

  it("caps the result at 6 titles", () => {
    const titles = Array.from({ length: 10 }, (_, index) => `Title ${index}`);
    expect(dedupeTitles(titles)).toHaveLength(6);
  });
});
