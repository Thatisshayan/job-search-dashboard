import { describe, expect, it, vi, beforeEach } from "vitest";
import { handleGeneralWorkCommand } from "./generalWork";

const getSearchSettingsForUser = vi.fn();
const setGeneralWorkEnabled = vi.fn();
const sendPlainMessage = vi.fn();

vi.mock("./db", () => ({
  getSearchSettingsForUser: (...args: unknown[]) => getSearchSettingsForUser(...args),
  setGeneralWorkEnabled: (...args: unknown[]) => setGeneralWorkEnabled(...args),
}));
vi.mock("../telegram", () => ({
  sendPlainMessage: (...args: unknown[]) => sendPlainMessage(...args),
}));

beforeEach(() => {
  getSearchSettingsForUser.mockReset();
  setGeneralWorkEnabled.mockReset();
  sendPlainMessage.mockReset();
});

describe("handleGeneralWorkCommand", () => {
  it("tells an un-onboarded user to /start first, without touching the settings row", async () => {
    getSearchSettingsForUser.mockResolvedValue(undefined);
    await handleGeneralWorkCommand("chat1", 1, "on");
    expect(setGeneralWorkEnabled).not.toHaveBeenCalled();
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining("/start"));
  });

  it("enables general work on 'on'", async () => {
    getSearchSettingsForUser.mockResolvedValue({ generalWorkEnabled: false });
    await handleGeneralWorkCommand("chat1", 1, "on");
    expect(setGeneralWorkEnabled).toHaveBeenCalledWith(1, true);
  });

  it("disables general work on 'off'", async () => {
    getSearchSettingsForUser.mockResolvedValue({ generalWorkEnabled: true });
    await handleGeneralWorkCommand("chat1", 1, "off");
    expect(setGeneralWorkEnabled).toHaveBeenCalledWith(1, false);
  });

  it("reports current status without mutating anything, for 'status' or no argument", async () => {
    getSearchSettingsForUser.mockResolvedValue({ generalWorkEnabled: true });
    await handleGeneralWorkCommand("chat1", 1, "status");
    expect(setGeneralWorkEnabled).not.toHaveBeenCalled();
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining("on"));

    sendPlainMessage.mockClear();
    getSearchSettingsForUser.mockResolvedValue({ generalWorkEnabled: false });
    await handleGeneralWorkCommand("chat1", 1, "");
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining("off"));
  });

  it("rejects an unrecognized argument with usage help", async () => {
    getSearchSettingsForUser.mockResolvedValue({ generalWorkEnabled: false });
    await handleGeneralWorkCommand("chat1", 1, "banana");
    expect(setGeneralWorkEnabled).not.toHaveBeenCalled();
    expect(sendPlainMessage).toHaveBeenCalledWith("chat1", expect.stringContaining("Usage"));
  });
});
