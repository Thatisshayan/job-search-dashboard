import { describe, expect, it } from "vitest";
import { planTextStep } from "./onboarding";

describe("planTextStep", () => {
  it("routes 'immediate' to the general track and on to the resume choice", () => {
    const result = planTextStep("awaiting_track_choice", "immediate", {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.nextState).toBe("awaiting_resume_choice");
    expect(result.context.track).toBe("general");
  });

  it("routes 'career' to the career track", () => {
    const result = planTextStep("awaiting_track_choice", "career work please", {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.context.track).toBe("career");
  });

  it("rejects an unrecognized track choice", () => {
    expect(planTextStep("awaiting_track_choice", "not sure", {}).ok).toBe(false);
  });

  it("routes 'ready' to the resume-upload step", () => {
    const result = planTextStep("awaiting_resume_choice", "ready", { track: "career" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.nextState).toBe("awaiting_resume");
    expect(result.context.track).toBe("career");
  });

  it("routes 'build' to the resume-build step", () => {
    const result = planTextStep("awaiting_resume_choice", "build one for me", { track: "general" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.nextState).toBe("awaiting_resume_build");
  });

  it("collects target titles and advances to awaiting_location", () => {
    const result = planTextStep("awaiting_target_titles", "Software Engineer, Backend Developer", { track: "career" });
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
    const result = planTextStep("awaiting_location", "Toronto, Ontario", { track: "career", targetTitles: ["Software Engineer"] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.nextState).toBe("awaiting_radius");
    expect(result.context.city).toBe("Toronto, Ontario");
  });

  it("rejects a too-short location", () => {
    const result = planTextStep("awaiting_location", "x", {});
    expect(result.ok).toBe(false);
  });

  it("advances from radius to the recurring choice, not straight to idle", () => {
    const context = { track: "career", targetTitles: ["Software Engineer"], city: "Toronto, Ontario" };
    const result = planTextStep("awaiting_radius", "50", context);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.nextState).toBe("awaiting_recurring_choice");
    expect(result.context.radiusKm).toBe(50);
  });

  it("rejects a non-numeric or out-of-range radius", () => {
    expect(planTextStep("awaiting_radius", "not a number", {}).ok).toBe(false);
    expect(planTextStep("awaiting_radius", "0", {}).ok).toBe(false);
    expect(planTextStep("awaiting_radius", "5000", {}).ok).toBe(false);
  });

  it("declining recurring checks finalizes immediately with dailyNotificationEnabled false", () => {
    const context = { track: "career", targetTitles: ["Software Engineer"], city: "Toronto, Ontario", radiusKm: 50 };
    const result = planTextStep("awaiting_recurring_choice", "no", context);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.nextState).toBe("idle");
    expect(result.context.dailyNotificationEnabled).toBe(false);
  });

  it("accepting recurring checks asks for a time next", () => {
    const result = planTextStep("awaiting_recurring_choice", "yes", {});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.nextState).toBe("awaiting_recurring_time");
    expect(result.context.dailyNotificationEnabled).toBe(true);
  });

  it("rejects an unrecognized recurring answer", () => {
    expect(planTextStep("awaiting_recurring_choice", "maybe", {}).ok).toBe(false);
  });

  it("accepts a valid HH:MM time and finalizes", () => {
    const result = planTextStep("awaiting_recurring_time", "07:30", { dailyNotificationEnabled: true });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok result");
    expect(result.nextState).toBe("idle");
    expect(result.context.scheduledTime).toBe("07:30");
  });

  it("rejects an invalid time format", () => {
    expect(planTextStep("awaiting_recurring_time", "7:30am", {}).ok).toBe(false);
    expect(planTextStep("awaiting_recurring_time", "25:00", {}).ok).toBe(false);
  });

  it("has a safe fallback for the idle state", () => {
    const result = planTextStep("idle", "anything", {});
    expect(result.ok).toBe(false);
  });
});
