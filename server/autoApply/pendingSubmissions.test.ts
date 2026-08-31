import { afterEach, describe, expect, it, vi } from "vitest";
import { discardPendingGreenhouseSubmission, savePendingGreenhouseSubmission, takePendingGreenhouseSubmission } from "./pendingSubmissions";

const sample = {
  resumePdf: Buffer.from("%PDF-fake"),
  coverLetterText: "Dear Hiring Manager, ...",
  candidate: { fullName: "Jordan Rivera", email: "jordan@example.com", phone: "555-0100" },
};

describe("pendingSubmissions", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns exactly what was saved, and only once (single-use)", () => {
    savePendingGreenhouseSubmission(101, sample);
    expect(takePendingGreenhouseSubmission(101)).toEqual(sample);
    expect(takePendingGreenhouseSubmission(101)).toBeNull();
  });

  it("returns null for an application id that was never saved", () => {
    expect(takePendingGreenhouseSubmission(999999)).toBeNull();
  });

  it("expires after 30 minutes, matching the approval card's own expiry window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    savePendingGreenhouseSubmission(102, sample);
    savePendingGreenhouseSubmission(103, sample);

    vi.setSystemTime(new Date("2026-01-01T00:29:00.000Z"));
    expect(takePendingGreenhouseSubmission(102)).not.toBeNull();

    vi.setSystemTime(new Date("2026-01-01T00:31:00.000Z"));
    expect(takePendingGreenhouseSubmission(103)).toBeNull();
  });

  it("discard removes an entry without returning it", () => {
    savePendingGreenhouseSubmission(104, sample);
    discardPendingGreenhouseSubmission(104);
    expect(takePendingGreenhouseSubmission(104)).toBeNull();
  });
});
