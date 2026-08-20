import { describe, expect, it } from "vitest";
import { createApprovalCallback, finalBrowserReviewText, hashApprovalNonce, resolveSingleUseApproval, verifyApprovalCallback } from "./telegram";

describe("Telegram application approval tokens", () => {
  it("accepts an intact signed callback and rejects altered callback data", () => {
    const nonce = "test_nonce_7hxA2";
    const callback = createApprovalCallback(42, "approve", nonce);
    expect(verifyApprovalCallback(callback)).toEqual({ applicationId: 42, decision: "approve", nonce });
    expect(verifyApprovalCallback(`${callback}x`)).toBeNull();
  });

  it("creates a deterministic server-side nonce hash without retaining the raw nonce", () => {
    expect(hashApprovalNonce("nonce-a")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashApprovalNonce("nonce-a")).not.toEqual(hashApprovalNonce("nonce-b"));
  });

  it("allows the first valid approval transition and treats a replay as a no-op", () => {
    const nonce = "single_use_nonce";
    const first = resolveSingleUseApproval({
      currentStatus: "awaiting_telegram_approval",
      storedNonceHash: hashApprovalNonce(nonce),
      expiresAt: new Date(Date.now() + 60_000),
      nonce,
      decision: "approve",
    });
    expect(first).toBe("ready_for_final_confirmation");
    const replay = resolveSingleUseApproval({
      currentStatus: first!,
      storedNonceHash: null,
      expiresAt: new Date(Date.now() + 60_000),
      nonce,
      decision: "approve",
    });
    expect(replay).toBeNull();
  });

  it("states the final browser-confirmation boundary in the approved follow-up", () => {
    const message = finalBrowserReviewText({ title: "Construction Project Manager", employer: "Example Builder" });
    expect(message).toContain("Open the original application");
    expect(message).toContain("final confirmation");
    expect(message).not.toContain("automatically submit");
  });
});
