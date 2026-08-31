import { describe, expect, it } from "vitest";
import { planTextStep } from "./onboarding";

describe("planTextStep", () => {
  it("collects target titles and advances to awaiting_location", () => {
    const result = planTextStep("awaiting_target_titles", "Software Engineer, Backend Developer", {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.nextState).toBe("awaiting_location");
    expect(result.context.targetTitles).toEqual(["Software Engineer", "Backend Developer"]);
  });

  it("rejects an empty title list and stays on the same step", () => {
    const result = planTextStep("awaiting_target_titles", "   ,  ,", {});
    expect(result.ok).toBe(false);
  });

  it("collects a location and advances to awaiting_radius", () => {
    const result = planTextStep("awaiting_location", "Toronto, Ontario", { targetTitles: ["Software Engineer"] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.nextState).toBe("awaiting_radius");
    expect(result.context.city).toBe("Toronto, Ontario");
  });

  it("rejects a too-short location", () => {
    const result = planTextStep("awaiting_location", "x", {});
    expect(result.ok).toBe(false);
  });

  it("finalizes settings on a valid radius and carries forward prior context", () => {
    const context = { targetTitles: ["Software Engineer"], city: "Toronto, Ontario" };
    const result = planTextStep("awaiting_radius", "50", context);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.nextState).toBe("idle");
    expect(result.context).toEqual({ targetTitles: ["Software Engineer"], city: "Toronto, Ontario", radiusKm: 50 });
  });

  it("rejects a non-numeric or out-of-range radius", () => {
    expect(planTextStep("awaiting_radius", "not a number", {}).ok).toBe(false);
    expect(planTextStep("awaiting_radius", "0", {}).ok).toBe(false);
    expect(planTextStep("awaiting_radius", "5000", {}).ok).toBe(false);
  });

  it("has a safe fallback for the idle state", () => {
    const result = planTextStep("idle", "anything", {});
    expect(result.ok).toBe(false);
  });
});
