import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const getDb = vi.fn();
vi.mock("./db", () => ({ getDb: () => getDb() }));
vi.mock("./telegramBot/notify", () => ({ runSearchAndNotify: vi.fn() }));
vi.mock("./telegramBot/generalWork", () => ({ runGeneralWorkAndNotify: vi.fn() }));

describe("tick overlap guard", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    getDb.mockReset();
  });

  it("skips a second tick that starts while the first is still running", async () => {
    let resolveSelect: (rows: unknown[]) => void;
    const slowSelect = new Promise<unknown[]>(resolve => {
      resolveSelect = resolve;
    });
    getDb.mockResolvedValue({
      select: () => ({ from: () => slowSelect }),
    });

    const { tick } = await import("./scheduler");
    const first = tick();
    const second = tick(); // fires while `first` is still awaiting the slow settingsRows query

    resolveSelect!([]);
    await first;
    await second;

    // getDb is called exactly once per tick that actually runs its body -- the
    // second, overlapping call should have returned immediately without
    // touching the db at all.
    expect(getDb).toHaveBeenCalledTimes(1);
  });

  it("processes multiple users independently, only running the one whose scheduled time matches", async () => {
    const { searchSettings, telegramConnections } = await import("../drizzle/schema");
    const { runSearchAndNotify } = await import("./telegramBot/notify");

    const matchingUser = { userId: 1, dailyNotificationEnabled: true, timezone: "UTC", scheduledTime: "07:30", track: "career" };
    const nonMatchingUser = { userId: 2, dailyNotificationEnabled: true, timezone: "UTC", scheduledTime: "23:59", track: "career" };

    getDb.mockResolvedValue({
      select: () => ({
        from: (table: unknown) => {
          if (table === searchSettings) return Promise.resolve([matchingUser, nonMatchingUser]);
          if (table === telegramConnections) {
            return { where: () => ({ limit: async () => [{ userId: matchingUser.userId, chatId: "chat-1" }] }) };
          }
          // jobRuns, via alreadyRanToday's db.select().from(jobRuns).where(...).orderBy(...).limit(1)
          return { where: () => ({ orderBy: () => ({ limit: async () => [] }) }) };
        },
      }),
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-12T07:30:00.000Z"));
    const { tick } = await import("./scheduler");
    await tick();
    vi.useRealTimers();

    expect(runSearchAndNotify).toHaveBeenCalledWith("chat-1", 1);
    expect(runSearchAndNotify).not.toHaveBeenCalledWith(expect.anything(), 2);
  });
});
