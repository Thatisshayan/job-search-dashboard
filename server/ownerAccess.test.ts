import { describe, expect, it } from "vitest";
import { isWorkspaceOwner } from "./ownerAccess";

describe("isWorkspaceOwner", () => {
  it("allows the configured owner identity even if a stale persisted role has not been reconciled", () => {
    expect(isWorkspaceOwner({ openId: "owner-open-id", role: "user" }, "owner-open-id")).toBe(true);
  });

  it("allows the persisted owner admin role but rejects ordinary users", () => {
    expect(isWorkspaceOwner({ openId: "owner-open-id", role: "admin" }, "different-open-id")).toBe(true);
    expect(isWorkspaceOwner({ openId: "another-user", role: "user" }, "owner-open-id")).toBe(false);
  });
});
