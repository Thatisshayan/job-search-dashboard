import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import SearchSettings from "./SearchSettings";

const settingsData = {
  settings: {
    targetTitles: ["Construction Project Manager"],
    city: "Toronto, Ontario",
    radiusKm: 75,
    minimumScore: 60,
    shortlistLimit: 20,
    scheduledTime: "07:30",
    dailyNotificationEnabled: true,
    employmentTypes: ["full-time"],
  },
  sources: [
    {
      id: 1,
      name: "Government of Canada Job Bank",
      enabled: true,
      lastStatus: "Ready",
    },
  ],
};

let isOwner = false;

vi.mock("@/hooks/useIsOwner", () => ({
  useIsOwner: () => ({ isOwner, isLoading: false }),
}));

const mutate = vi.fn();
vi.mock("@/lib/trpc", () => ({
  trpc: {
    dashboard: {
      settings: { useQuery: () => ({ data: settingsData, isLoading: false }) },
      updateSettings: { useMutation: () => ({ mutate, isPending: false }) },
      setSourceEnabled: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      addSource: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    useUtils: () => ({
      dashboard: {
        settings: { invalidate: vi.fn() },
        overview: { invalidate: vi.fn() },
      },
    }),
  },
}));

describe("SearchSettings", () => {
  beforeEach(() => {
    mutate.mockClear();
    isOwner = false;
  });

  it("shows a read-only notice and disables the save button for a non-owner viewer", () => {
    isOwner = false;
    render(<SearchSettings />);
    expect(
      screen.getByText(/read-only copy of these settings/i)
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save search settings/i })
    ).toBeDisabled();
  });

  it("enables editing and save for the owner", () => {
    isOwner = true;
    render(<SearchSettings />);
    expect(
      screen.queryByText(/read-only copy of these settings/i)
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save search settings/i })
    ).toBeEnabled();
  });
});
