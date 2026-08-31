import { describe, expect, it } from "vitest";
import { createApprovalCallback, finalBrowserReviewText, fromGreenhouseConfirmCallback, hashApprovalNonce, isGreenhouseConfirmCallback, originalLinkReviewText, resolveSingleUseApproval, toGreenhouseConfirmCallback, verifyApprovalCallback } from "./telegram";

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

  it("resolves the Greenhouse auto-submit confirmation transition (ready_for_auto_submit_confirmation -> submitted/declined), distinct from the default Approve transition", () => {
    const nonce = "confirm_nonce_1";
    const approved = resolveSingleUseApproval({
      currentStatus: "ready_for_auto_submit_confirmation",
      storedNonceHash: hashApprovalNonce(nonce),
      expiresAt: new Date(Date.now() + 60_000),
      nonce,
      decision: "approve",
      expectedStatus: "ready_for_auto_submit_confirmation",
      approvedStatus: "submitted",
      declinedStatus: "declined",
    });
    expect(approved).toBe("submitted");

    // Wrong current status (e.g. still just "awaiting_telegram_approval",
    // the first-stage status) must not resolve — the two stages must not
    // be interchangeable.
    const wrongStage = resolveSingleUseApproval({
      currentStatus: "awaiting_telegram_approval",
      storedNonceHash: hashApprovalNonce(nonce),
      expiresAt: new Date(Date.now() + 60_000),
      nonce,
      decision: "approve",
      expectedStatus: "ready_for_auto_submit_confirmation",
      approvedStatus: "submitted",
      declinedStatus: "declined",
    });
    expect(wrongStage).toBeNull();

    const declined = resolveSingleUseApproval({
      currentStatus: "ready_for_auto_submit_confirmation",
      storedNonceHash: hashApprovalNonce(nonce),
      expiresAt: new Date(Date.now() + 60_000),
      nonce,
      decision: "decline",
      expectedStatus: "ready_for_auto_submit_confirmation",
      approvedStatus: "submitted",
      declinedStatus: "declined",
    });
    expect(declined).toBe("declined");
  });

  it("still defaults to the original Approve/Decline transition when no stage overrides are passed", () => {
    const nonce = "default_nonce";
    const result = resolveSingleUseApproval({
      currentStatus: "awaiting_telegram_approval",
      storedNonceHash: hashApprovalNonce(nonce),
      expiresAt: new Date(Date.now() + 60_000),
      nonce,
      decision: "approve",
    });
    expect(result).toBe("ready_for_final_confirmation");
  });

  it("wraps and unwraps a Greenhouse confirm callback without altering its signature, and it never collides with a plain approval callback", () => {
    const nonce = "gh_confirm_nonce";
    const original = createApprovalCallback(7, "approve", nonce);
    const wrapped = toGreenhouseConfirmCallback(original);

    expect(isGreenhouseConfirmCallback(wrapped)).toBe(true);
    expect(isGreenhouseConfirmCallback(original)).toBe(false);

    const unwrapped = fromGreenhouseConfirmCallback(wrapped);
    expect(unwrapped).toBe(original);
    expect(verifyApprovalCallback(unwrapped!)).toEqual({ applicationId: 7, decision: "approve", nonce });

    // A plain v1. callback fed to the confirm-flow unwrapper must not be
    // silently accepted — it isn't a confirm callback at all.
    expect(fromGreenhouseConfirmCallback(original)).toBeNull();
  });

  it("labels a direct original-link review without implying approval or submission", () => {
    const message = originalLinkReviewText({
      rank: 1,
      score: 100,
      title: "Construction Manager",
      employer: "Example Builder",
      location: "Toronto, ON",
      sourceName: "Government of Canada Job Bank",
    });
    expect(message).toContain("Verified shortlist match #1");
    expect(message).toContain("Opening this link does not submit");
    expect(message).toContain("final confirmation");
  });
});
