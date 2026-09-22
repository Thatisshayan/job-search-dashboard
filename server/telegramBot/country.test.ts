import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleCountryCommand } from "./country";

const getSearchSettingsForUser = vi.fn();
const setUserCountry = vi.fn();
const sendPlainMessage = vi.fn();

vi.mock("./db", () => ({
  getSearchSettingsForUser: (...args: unknown[]) => getSearchSettingsForUser(...args),
  setUserCountry: (...args: unknown[]) => setUserCountry(...args),
}));
vi.mock("../telegram", () => ({
  sendPlainMessage: (...args: unknown[]) => sendPlainMessage(...args),
}));

beforeEach(() => {
  getSearchSettingsForUser.mockReset();
  setUserCountry.mockReset();
  sendPlainMessage.mockReset();
});

describe("handleCountryCommand", () => {
  it("tells an un-onboarded user to /start first, without touching the settings row", async () => {
    getSearchSettingsForUser.mockResolvedValue(undefined);
    await handleCountryCommand("chat1", 1, "us");
    expect(setUserCountry).not.toHaveBeenCalled();
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining("/start"));
  });

  it("sets a valid two-letter code, lowercased", async () => {
    getSearchSettingsForUser.mockResolvedValue({ country: null });
    await handleCountryCommand("chat1", 1, "US");
    expect(setUserCountry).toHaveBeenCalledWith(1, "us");
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining('"us"'));
  });

  it("rejects a code that isn't two letters, without mutating anything", async () => {
    getSearchSettingsForUser.mockResolvedValue({ country: null });
    await handleCountryCommand("chat1", 1, "Toronto");
    expect(setUserCountry).not.toHaveBeenCalled();
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining("doesn't look like"));
  });

  it("resets back to the deployment default on 'reset'", async () => {
    getSearchSettingsForUser.mockResolvedValue({ country: "gb" });
    await handleCountryCommand("chat1", 1, "reset");
    expect(setUserCountry).toHaveBeenCalledWith(1, null);
  });

  it("shows the current setting and does nothing else when called with no argument", async () => {
    getSearchSettingsForUser.mockResolvedValue({ country: "gb" });
    await handleCountryCommand("chat1", 1, "");
    expect(setUserCountry).not.toHaveBeenCalled();
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining('"gb"'));

    sendPlainMessage.mockClear();
    getSearchSettingsForUser.mockResolvedValue({ country: null });
    await handleCountryCommand("chat1", 1, "");
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining("default"));
  });
});
