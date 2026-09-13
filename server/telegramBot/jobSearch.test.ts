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

import { runGeneralWorkSearchForUser, runJobSearchForUser } from "./jobSearch";

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
    insert: () => ({ values: () => [{ insertId: 1 }] }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
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
        id: "abc123",
        title: { text: "Backend Engineer" },
        company: { name: "Acme" },
        location: { formatted: "Toronto" },
        description: { text: "A".repeat(100) },
        apply: { url: "https://indeed.com/1" },
        dates: { posted: "2026-09-01" },
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

describe("runJobSearchForUser claims its jobRuns row early", () => {
  beforeEach(() => {
    listGreenhouseWatches.mockResolvedValue([]);
    importVerifiedListingBatch.mockResolvedValue({ imported: 1, shortlisted: 1, duplicatesMerged: 0 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a claim jobRuns row before calling any discovery source", async () => {
    const callOrder: string[] = [];
    const insertMock = vi.fn(() => ({
      values: vi.fn(() => {
        callOrder.push("jobRuns.insert");
        return [{ insertId: 42 }];
      }),
    }));
    getDb.mockResolvedValue({ ...mockDb(), insert: insertMock, update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })) });

    searchAdzunaJobs.mockImplementation(async () => {
      callOrder.push("adzuna.search");
      return [];
    });
    searchIndeedJobs.mockImplementation(async () => {
      callOrder.push("indeed.search");
      return [];
    });

    await runJobSearchForUser(1);

    expect(callOrder[0]).toBe("jobRuns.insert");
    expect(callOrder).toContain("adzuna.search");
  });
});

describe("runGeneralWorkSearchForUser claims its jobRuns row early", () => {
  beforeEach(() => {
    listGreenhouseWatches.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("inserts a claim jobRuns row before calling Adzuna", async () => {
    const callOrder: string[] = [];
    const dbStub = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [settingsRow] }) }) }),
      insert: vi.fn(() => ({
        values: vi.fn(() => {
          callOrder.push("jobRuns.insert");
          return [{ insertId: 99 }];
        }),
      })),
      update: vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) })),
    };
    getDb.mockResolvedValue(dbStub);

    searchAdzunaJobs.mockImplementation(async () => {
      callOrder.push("adzuna.search");
      return [];
    });

    await runGeneralWorkSearchForUser(1);

    expect(callOrder[0]).toBe("jobRuns.insert");
    expect(callOrder).toContain("adzuna.search");
  });
});

const invokeLLM = vi.fn();
vi.mock("../_core/llm", () => ({ invokeLLM: (...args: unknown[]) => invokeLLM(...args) }));

describe("runJobSearchForUser cross-source dedup", () => {
  beforeEach(() => {
    getDb.mockResolvedValue(mockDb());
    listGreenhouseWatches.mockResolvedValue([]);
    importVerifiedListingBatch.mockResolvedValue({ imported: 1, shortlisted: 1, duplicatesMerged: 0 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("drops the duplicate copy before importing when Adzuna and Indeed find the same job", async () => {
    searchAdzunaJobs.mockResolvedValue([
      {
        id: "a1",
        title: "Backend Engineer",
        description: "A".repeat(100),
        company: { display_name: "Acme" },
        location: { display_name: "Toronto" },
        contract_time: "full_time",
        created: "2026-09-01T00:00:00Z",
        redirect_url: "https://adzuna.com/a1",
      },
    ]);
    searchIndeedJobs.mockResolvedValue([
      {
        id: "b1",
        title: { text: "Backend Engineer" },
        description: { text: "A".repeat(300) },
        company: { name: "Acme" },
        location: { formatted: "Toronto" },
        apply: { url: "https://indeed.com/b1" },
        dates: { posted: "2026-09-01" },
      },
    ]);
    invokeLLM.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ duplicatePairs: [["a1", "b1"]] }) } }],
    });

    await runJobSearchForUser(1);

    const importedSourceNames = importVerifiedListingBatch.mock.calls.map(call => call[1][0]?.sourceName);
    // Adzuna's list should have been emptied by dedup (Indeed's longer description won pickMostComplete),
    // so only Indeed's block actually imports anything for this employer.
    expect(importedSourceNames.filter(Boolean)).toEqual(["Indeed"]);
  });
});
