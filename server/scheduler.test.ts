import { describe, expect, it } from "vitest";
import { currentHHMM } from "./scheduler";

describe("scheduler time matching", () => {
  it("formats the current time in a given IANA timezone as HH:MM", () => {
    expect(currentHHMM("America/Toronto", new Date("2026-08-31T11:30:00.000Z"))).toBe("07:30");
    expect(currentHHMM("UTC", new Date("2026-08-31T11:30:00.000Z"))).toBe("11:30");
  });

  it("handles timezones ahead of UTC and rolling past midnight", () => {
    expect(currentHHMM("Asia/Tokyo", new Date("2026-08-31T16:05:00.000Z"))).toBe("01:05");
  });
});
