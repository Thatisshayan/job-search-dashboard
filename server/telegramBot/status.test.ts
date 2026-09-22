import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleStatusCommand } from "./status";

const getSearchSettingsForUser = vi.fn();
const listGreenhouseWatches = vi.fn();
const sendPlainMessage = vi.fn();
const getDb = vi.fn();

vi.mock("./db", () => ({
  getSearchSettingsForUser: (...args: unknown[]) => getSearchSettingsForUser(...args),
  listGreenhouseWatches: (...args: unknown[]) => listGreenhouseWatches(...args),
}));
vi.mock("../telegram", () => ({
  sendPlainMessage: (...args: unknown[]) => sendPlainMessage(...args),
}));
vi.mock("../db", () => ({ getDb: () => getDb() }));

function mockDbReturning(row: unknown) {
  getDb.mockResolvedValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(row ? [row] : []),
        }),
      }),
    }),
  });
}

beforeEach(() => {
  getSearchSettingsForUser.mockReset();
  listGreenhouseWatches.mockReset();
  sendPlainMessage.mockReset();
  getDb.mockReset();
  listGreenhouseWatches.mockResolvedValue([]);
});

describe("handleStatusCommand", () => {
  it("tells an un-onboarded user to /start first", async () => {
    getSearchSettingsForUser.mockResolvedValue(undefined);
    await handleStatusCommand("chat1", 1);
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining("/start"));
  });

  it("summarizes a career-track user's full setup", async () => {
    getSearchSettingsForUser.mockResolvedValue({
      track: "career",
      targetTitles: ["Backend Engineer"],
      city: "Toronto, Ontario",
      radiusKm: 50,
      country: "us",
      dailyNotificationEnabled: true,
      scheduledTime: "07:30",
      timezone: "America/Toronto",
      generalWorkEnabled: false,
    });
    mockDbReturning({ displayName: "Jane Doe", resumeLabel: "Resume.pdf" });
    listGreenhouseWatches.mockResolvedValue([{ name: "Greenhouse:acme", lastStatus: "Watching Acme's Greenhouse board" }]);

    await handleStatusCommand("chat1", 1);

    const [, text] = sendPlainMessage.mock.calls[0];
    expect(text).toContain("Jane Doe");
    expect(text).toContain("Backend Engineer");
    expect(text).toContain("Toronto, Ontario");
    expect(text).toContain("Search country: us");
    expect(text).toContain("07:30");
    expect(text).toContain("Watching 1 company");
  });

  it("omits target roles for the general-work track and shows the deployment default when no country is set", async () => {
    getSearchSettingsForUser.mockResolvedValue({
      track: "general",
      targetTitles: [],
      city: "Toronto, Ontario",
      radiusKm: 25,
      country: null,
      dailyNotificationEnabled: false,
      scheduledTime: "07:30",
      timezone: "America/Toronto",
      generalWorkEnabled: true,
    });
    mockDbReturning(undefined);

    await handleStatusCommand("chat1", 1);

    const [, text] = sendPlainMessage.mock.calls[0];
    expect(text).not.toContain("Target roles");
    expect(text).toContain("deployment's default");
    expect(text).toContain("none on file");
    expect(text).toContain("off");
  });
});
