import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleCitiesCommand } from "./cities";

const getSearchSettingsForUser = vi.fn();
const setUserTargetCities = vi.fn();
const sendPlainMessage = vi.fn();

vi.mock("./db", () => ({
  getSearchSettingsForUser: (...args: unknown[]) => getSearchSettingsForUser(...args),
  setUserTargetCities: (...args: unknown[]) => setUserTargetCities(...args),
}));
vi.mock("../telegram", () => ({
  sendPlainMessage: (...args: unknown[]) => sendPlainMessage(...args),
}));

const baseSettings = { city: "Toronto, Ontario", radiusKm: 75, targetCities: null as string[] | null };

beforeEach(() => {
  getSearchSettingsForUser.mockReset();
  setUserTargetCities.mockReset();
  sendPlainMessage.mockReset();
});

describe("handleCitiesCommand", () => {
  it("tells an un-onboarded user to /start first", async () => {
    getSearchSettingsForUser.mockResolvedValue(undefined);
    await handleCitiesCommand("chat1", 1, "add Montreal");
    expect(setUserTargetCities).not.toHaveBeenCalled();
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining("/start"));
  });

  it("shows just the primary city when no extras are set (no argument)", async () => {
    getSearchSettingsForUser.mockResolvedValue(baseSettings);
    await handleCitiesCommand("chat1", 1, "");
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining("Toronto, Ontario"));
    expect(setUserTargetCities).not.toHaveBeenCalled();
  });

  it("adds a new city on top of the primary one", async () => {
    getSearchSettingsForUser.mockResolvedValue(baseSettings);
    await handleCitiesCommand("chat1", 1, "add Montreal, Quebec");
    expect(setUserTargetCities).toHaveBeenCalledWith(1, ["Montreal, Quebec"]);
  });

  it("refuses to add a duplicate of a city already being searched", async () => {
    getSearchSettingsForUser.mockResolvedValue({ ...baseSettings, targetCities: ["Montreal, Quebec"] });
    await handleCitiesCommand("chat1", 1, "add montreal, quebec");
    expect(setUserTargetCities).not.toHaveBeenCalled();
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining("Already searching"));
  });

  it("removes an extra city, keeping the rest", async () => {
    getSearchSettingsForUser.mockResolvedValue({ ...baseSettings, targetCities: ["Montreal, Quebec", "Ottawa, Ontario"] });
    await handleCitiesCommand("chat1", 1, "remove Montreal, Quebec");
    expect(setUserTargetCities).toHaveBeenCalledWith(1, ["Ottawa, Ontario"]);
  });

  it("refuses to remove the primary city, pointing to /edit instead", async () => {
    getSearchSettingsForUser.mockResolvedValue(baseSettings);
    await handleCitiesCommand("chat1", 1, "remove Toronto, Ontario");
    expect(setUserTargetCities).not.toHaveBeenCalled();
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining("/edit"));
  });

  it("resets back to single-city mode", async () => {
    getSearchSettingsForUser.mockResolvedValue({ ...baseSettings, targetCities: ["Montreal, Quebec"] });
    await handleCitiesCommand("chat1", 1, "reset");
    expect(setUserTargetCities).toHaveBeenCalledWith(1, null);
  });

  it("shows usage help for an unrecognized subcommand", async () => {
    getSearchSettingsForUser.mockResolvedValue(baseSettings);
    await handleCitiesCommand("chat1", 1, "banana");
    expect(setUserTargetCities).not.toHaveBeenCalled();
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining("Usage"));
  });
});
