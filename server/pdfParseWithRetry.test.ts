import { beforeEach, describe, expect, it, vi } from "vitest";

const pdfParseMock = vi.fn();
vi.mock("pdf-parse", () => ({ default: (...args: unknown[]) => pdfParseMock(...args) }));

import { parsePdfWithRetry } from "./pdfParseWithRetry";

describe("parsePdfWithRetry", () => {
  beforeEach(() => pdfParseMock.mockClear());

  it("returns the result on a successful first call, no retry needed", async () => {
    pdfParseMock.mockResolvedValueOnce({ text: "hello" });
    const result = await parsePdfWithRetry(Buffer.from("x"));
    expect(result.text).toBe("hello");
    expect(pdfParseMock).toHaveBeenCalledTimes(1);
  });

  it("retries once and succeeds if the first call throws (the known pdf-parse cold-start quirk)", async () => {
    pdfParseMock.mockRejectedValueOnce(new Error("Command token too long: 128"));
    pdfParseMock.mockResolvedValueOnce({ text: "recovered" });
    const result = await parsePdfWithRetry(Buffer.from("x"));
    expect(result.text).toBe("recovered");
    expect(pdfParseMock).toHaveBeenCalledTimes(2);
  });

  it("throws the original (first) error if both attempts fail", async () => {
    pdfParseMock.mockRejectedValueOnce(new Error("first failure"));
    pdfParseMock.mockRejectedValueOnce(new Error("second failure"));
    await expect(parsePdfWithRetry(Buffer.from("x"))).rejects.toThrow("first failure");
  });
});
