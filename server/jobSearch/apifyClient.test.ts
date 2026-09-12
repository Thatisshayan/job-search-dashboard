import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnv = vi.hoisted(() => ({ apifyApiToken: "test-token" }));
vi.mock("../_core/env", () => ({ ENV: mockEnv }));

import { isApifyConfigured, runApifyActor } from "./apifyClient";

describe("isApifyConfigured", () => {
  afterEach(() => {
    mockEnv.apifyApiToken = "test-token";
  });

  it("is false when APIFY_API_TOKEN is unset", () => {
    mockEnv.apifyApiToken = "";
    expect(isApifyConfigured()).toBe(false);
  });
});

describe("runApifyActor", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    mockEnv.apifyApiToken = "test-token";
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    fetchMock.mockReset();
  });

  it("starts a run, polls until SUCCEEDED, and returns the dataset items", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "run1", status: "RUNNING", defaultDatasetId: "ds1" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "run1", status: "RUNNING", defaultDatasetId: "ds1" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "run1", status: "SUCCEEDED", defaultDatasetId: "ds1" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => [{ title: "Job A" }, { title: "Job B" }],
      });

    const resultPromise = runApifyActor<{ title: string }>("some/actor", { position: "Engineer" });
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    const result = await resultPromise;

    expect(result).toEqual([{ title: "Job A" }, { title: "Job B" }]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0][0]).toContain("/acts/some%2Factor/runs");
  });

  it("throws if the run ends in a non-SUCCEEDED terminal status", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "run2", status: "RUNNING", defaultDatasetId: "ds2" } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: "run2", status: "FAILED", defaultDatasetId: "ds2" } }),
      });

    const resultPromise = runApifyActor("some/actor", {});
    const assertion = expect(resultPromise).rejects.toThrow("ended with status FAILED");
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;
  });

  it("throws if the run does not finish within the poll cap", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: "run3", status: "RUNNING", defaultDatasetId: "ds3" } }),
    });

    const resultPromise = runApifyActor("some/actor", {});
    const assertion = expect(resultPromise).rejects.toThrow("did not finish within");
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 3_000);
    await assertion;
  });

  it("throws if APIFY_API_TOKEN is not configured", async () => {
    mockEnv.apifyApiToken = "";
    await expect(runApifyActor("some/actor", {})).rejects.toThrow("APIFY_API_TOKEN is not configured");
  });
});
