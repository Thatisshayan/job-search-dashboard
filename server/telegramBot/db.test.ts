import { describe, expect, it, vi } from "vitest";

const insertValues = vi.fn();
const onDuplicateKeyUpdate = vi.fn();
const selectLimit = vi.fn();

vi.mock("../db", () => ({
  getDb: async () => ({
    select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
    insert: () => ({ values: insertValues }),
  }),
}));

import { ensureSourceEnabled } from "./db";

describe("ensureSourceEnabled", () => {
  it("uses a native upsert (onDuplicateKeyUpdate), not a read-then-insert", async () => {
    insertValues.mockReturnValue({ onDuplicateKeyUpdate });
    onDuplicateKeyUpdate.mockResolvedValue(undefined);

    await ensureSourceEnabled(1, "Adzuna");

    expect(insertValues).toHaveBeenCalledWith(expect.objectContaining({ userId: 1, name: "Adzuna", enabled: true }));
    expect(onDuplicateKeyUpdate).toHaveBeenCalledWith(expect.objectContaining({ set: expect.objectContaining({ enabled: true }) }));
    // No read-then-check step -- the pre-check select from before this
    // change should never be called.
    expect(selectLimit).not.toHaveBeenCalled();
  });
});
