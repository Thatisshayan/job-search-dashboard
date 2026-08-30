import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import JobCard from "./JobCard";

const baseItem = {
  entry: { rank: 1, score: 82, isNew: true },
  job: {
    id: 1,
    title: "Construction Project Manager",
    employer: "Acme Builders",
    location: "Toronto, Ontario",
    employmentType: "full-time",
    postedAt: new Date().toISOString(),
    originalApplyUrl: "https://example.com/apply",
    sourceName: "Government of Canada Job Bank",
    status: "active",
  },
  scorecard: {
    totalScore: 82,
    roleAlignment: 30,
    resumeSkillMatch: 20,
    seniorityAlignment: 15,
    locationCommuteFit: 10,
    employmentQualityFit: 5,
    recencyReadiness: 2,
    penalties: 0,
    rationale: "Strong alignment with target roles.",
    notableGaps: [],
    evidence: [],
  },
  action: null,
  application: null,
};

describe("JobCard", () => {
  it("hides application tracking controls for a public (non-owner) viewer", () => {
    render(<JobCard item={baseItem} owner={{ isOwner: false }} />);
    expect(
      screen.getByText(/not shown in this public view/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/prepare for telegram review/i)
    ).not.toBeInTheDocument();
  });

  it("shows owner controls and fires callbacks when the owner is viewing", () => {
    const onPrepareApplication = vi.fn();
    render(
      <JobCard
        item={baseItem}
        owner={{ isOwner: true, onPrepareApplication }}
      />
    );

    expect(
      screen.getByText(/application tracking \(owner only\)/i)
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /prepare for telegram review/i })
    );
    expect(onPrepareApplication).toHaveBeenCalledTimes(1);
  });

  it("renders a disabled apply button when there is no verified apply link", () => {
    const item = {
      ...baseItem,
      job: { ...baseItem.job, originalApplyUrl: null },
    };
    render(<JobCard item={item} owner={{ isOwner: false }} />);
    expect(
      screen.getByRole("button", { name: /apply on original site/i })
    ).toBeDisabled();
  });
});
