import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const searchAdzunaJobs = vi.fn();
const searchIndeedJobs = vi.fn();
const searchGreenhouseBoardJobs = vi.fn();
const importVerifiedListingBatch = vi.fn();
const ensureSourceEnabled = vi.fn();
const listGreenhouseWatches = vi.fn();
const getDb = vi.fn();

vi.mock("../jobSearch/adzuna", async () => {
  const actual = await vi.importActual<typeof import("../jobSearch/adzuna")>("../jobSearch/adzuna");
  return { ...actual, searchAdzunaJobs: (...args: unknown[]) => searchAdzunaJobs(...args), isAdzunaConfigured: () => true };
});
vi.mock("../jobSearch/indeedApify", async () => {
  const actual = await vi.importActual<typeof import("../jobSearch/indeedApify")>("../jobSearch/indeedApify");
  return { ...actual, searchIndeedJobs: (...args: unknown[]) => searchIndeedJobs(...args), isApifyConfigured: () => true };
});
vi.mock("../jobSearch/greenhouseBoard", async () => {
  const actual = await vi.importActual<typeof import("../jobSearch/greenhouseBoard")>("../jobSearch/greenhouseBoard");
  return { ...actual, searchGreenhouseBoardJobs: (...args: unknown[]) => searchGreenhouseBoardJobs(...args) };
});
vi.mock("./db", () => ({
  ensureSourceEnabled: (...args: unknown[]) => ensureSourceEnabled(...args),
  listGreenhouseWatches: (...args: unknown[]) => listGreenhouseWatches(...args),
}));
vi.mock("../db", () => ({ getDb: () => getDb() }));
vi.mock("../verifiedListingImport", () => ({
  importVerifiedListingBatch: (...args: unknown[]) => importVerifiedListingBatch(...args),
}));

import { runJobSearchForUser } from "./jobSearch";

const settingsRow = { userId: 1, targetTitles: ["Backend Engineer"], city: "Toronto", radiusKm: 25 };

function mockDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [settingsRow],
        }),
      }),
    }),
  };
}

describe("runJobSearchForUser", () => {
  beforeEach(() => {
    getDb.mockResolvedValue(mockDb());
    listGreenhouseWatches.mockResolvedValue([]);
    importVerifiedListingBatch.mockResolvedValue({ imported: 1, shortlisted: 1, duplicatesMerged: 0 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("imports Indeed results alongside Adzuna's", async () => {
    searchAdzunaJobs.mockResolvedValue([]);
    searchIndeedJobs.mockResolvedValue([
      {
        positionName: "Backend Engineer",
        company: "Acme",
        location: "Toronto",
        description: "A".repeat(100),
        url: "https://indeed.com/1",
        postedAt: "2026-09-01T00:00:00Z",
      },
    ]);

    const result = await runJobSearchForUser(1);
    expect(result.ok).toBe(true);
    expect(ensureSourceEnabled).toHaveBeenCalledWith(1, "Indeed");
    expect(importVerifiedListingBatch).toHaveBeenCalledWith(
      1,
      expect.arrayContaining([expect.objectContaining({ sourceName: "Indeed", title: "Backend Engineer" })])
    );
  });

  it("continues past an Indeed search failure for one title without failing the whole run", async () => {
    searchAdzunaJobs.mockResolvedValue([]);
    searchIndeedJobs.mockRejectedValue(new Error("Apify actor start failed: 500"));

    const result = await runJobSearchForUser(1);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe("no_results");
  });
});
