import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ScoreBreakdown from "@/components/ScoreBreakdown";
import {
  CircleAlert,
  ExternalLink,
  Loader2,
  MapPin,
  Send,
  Sparkles,
} from "lucide-react";

type ActionStatus =
  | "none"
  | "saved"
  | "opened"
  | "applied"
  | "not_interested"
  | "reported_stale";
type ApplicationStatus =
  | "drafting"
  | "awaiting_telegram_approval"
  | "declined"
  | "ready_for_final_confirmation"
  | "ready_for_auto_submit_confirmation"
  | "submitted"
  | "not_pursuing"
  | "expired";

type JobCardItem = {
  entry: { rank: number; score: number; isNew: boolean };
  job: {
    id: number;
    title: string;
    employer: string;
    location: string;
    employmentType: string | null;
    postedAt: Date | string | null;
    originalApplyUrl: string | null;
    sourceName: string;
    status: string;
  };
  scorecard: {
    totalScore: number;
    roleAlignment: number;
    resumeSkillMatch: number;
    seniorityAlignment: number;
    locationCommuteFit: number;
    employmentQualityFit: number;
    recencyReadiness: number;
    penalties: number;
    rationale: string;
    notableGaps: unknown;
    evidence: unknown;
  };
  action: { status: ActionStatus } | null;
  application: { status: ApplicationStatus; testMode: boolean } | null;
};

const actionLabels: Record<ActionStatus, string> = {
  none: "No action yet",
  saved: "Saved",
  opened: "Opened",
  applied: "Applied",
  not_interested: "Not interested",
  reported_stale: "Reported stale",
};

const applicationStatusLabels: Record<ApplicationStatus, string> = {
  drafting: "Drafting",
  awaiting_telegram_approval: "Awaiting Telegram approval",
  declined: "Declined",
  ready_for_final_confirmation: "Ready — final confirmation needed",
  ready_for_auto_submit_confirmation: "Filled — awaiting submit confirmation",
  submitted: "Submitted",
  not_pursuing: "Not pursuing",
  expired: "Expired",
};

function postedLabel(value: Date | string | null) {
  if (!value) return "Posted date unavailable";
  const date = new Date(value);
  const days = Math.max(
    0,
    Math.floor((Date.now() - date.getTime()) / 86_400_000)
  );
  if (days === 0) return "Posted today";
  return `Posted ${days}d ago`;
}

export type JobCardOwnerActions = {
  isOwner: boolean;
  onSetAction?: (status: ActionStatus) => void;
  isSettingAction?: boolean;
  onPrepareApplication?: () => void;
  isPreparingApplication?: boolean;
};

export default function JobCard({
  item,
  owner,
}: {
  item: JobCardItem;
  owner?: JobCardOwnerActions;
}) {
  const score = item.scorecard.totalScore;
  const gaps = Array.isArray(item.scorecard.notableGaps)
    ? item.scorecard.notableGaps.filter(
        (gap): gap is string => typeof gap === "string"
      )
    : [];
  const canApply = Boolean(
    item.job.originalApplyUrl && item.job.status === "active"
  );
  const isOwner = owner?.isOwner ?? false;

  return (
    <Card className="overflow-hidden border-border/90 bg-card shadow-[0_8px_30px_rgba(18,57,69,0.06)] transition-shadow hover:shadow-[0_14px_38px_rgba(18,57,69,0.11)]">
      <CardContent className="p-0">
        <div className="border-b bg-gradient-to-r from-primary/[0.04] to-transparent px-5 py-4 md:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-primary/20 bg-primary/5 text-primary"
                >
                  #{item.entry.rank} shortlist
                </Badge>
                {item.entry.isNew && (
                  <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">
                    New today
                  </Badge>
                )}
                <Badge variant="secondary">
                  {item.job.employmentType || "Employment type not stated"}
                </Badge>
              </div>
              <h2 className="mt-3 text-xl font-bold tracking-tight text-foreground md:text-2xl">
                {item.job.title}
              </h2>
              <p className="mt-1 text-sm font-semibold text-primary">
                {item.job.employer}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  {item.job.location}
                </span>
                <span>{postedLabel(item.job.postedAt)}</span>
                <span>Source: {item.job.sourceName}</span>
              </div>
            </div>
            <div className="flex items-center gap-4 lg:justify-end">
              <div
                className="score-ring relative flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full"
                style={
                  {
                    "--score-progress": `${score * 3.6}deg`,
                  } as React.CSSProperties
                }
              >
                <div className="flex h-[56px] w-[56px] flex-col items-center justify-center rounded-full bg-card">
                  <span className="font-data text-lg font-medium">{score}</span>
                  <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                    fit
                  </span>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Fit score
                </p>
                <p className="mt-1 text-sm font-semibold text-primary">
                  {score >= 80
                    ? "Strong match"
                    : score >= 60
                      ? "Worth review"
                      : "Lower priority"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-6 p-5 md:p-6 xl:grid-cols-[minmax(0,1fr)_290px]">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <h3 className="font-semibold">Why this was selected</h3>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {item.scorecard.rationale}
            </p>
            {gaps.length > 0 && (
              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="flex items-start gap-2">
                  <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-amber-900">
                      Notable gaps
                    </p>
                    <ul className="mt-1 space-y-1 text-sm leading-5 text-amber-900">
                      {gaps.map(gap => (
                        <li key={gap}>• {gap}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {isOwner ? (
              <div className="mt-5 space-y-3 rounded-xl border bg-muted/30 p-4">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Application tracking (owner only)
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <Select
                    value={item.action?.status ?? "none"}
                    onValueChange={value =>
                      owner?.onSetAction?.(value as ActionStatus)
                    }
                    disabled={owner?.isSettingAction}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(actionLabels) as ActionStatus[]).map(
                        status => (
                          <SelectItem key={status} value={status}>
                            {actionLabels[status]}
                          </SelectItem>
                        )
                      )}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={owner?.isPreparingApplication || !canApply}
                    onClick={() => owner?.onPrepareApplication?.()}
                  >
                    {owner?.isPreparingApplication ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-2 h-4 w-4" />
                    )}
                    Prepare for Telegram review
                  </Button>
                </div>
                {item.application && (
                  <p className="text-xs text-muted-foreground">
                    Application status:{" "}
                    <span className="font-medium text-foreground">
                      {applicationStatusLabels[item.application.status]}
                    </span>
                    {item.application.testMode && " (test mode)"}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-5 text-xs leading-5 text-muted-foreground">
                Application tracking and Telegram approval controls are not
                shown in this public view.
              </p>
            )}
          </div>

          <aside className="rounded-2xl border bg-muted/35 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
              Score breakdown
            </p>
            <div className="mt-4">
              <ScoreBreakdown scorecard={item.scorecard} />
            </div>
            {canApply ? (
              <Button
                asChild
                className="mt-5 w-full bg-amber-400 text-amber-950 hover:bg-amber-300"
              >
                <a
                  href={item.job.originalApplyUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Apply on original site
                  <ExternalLink className="ml-2 h-4 w-4" />
                </a>
              </Button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button disabled className="mt-5 w-full">
                      Apply on original site
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  No verified original application link is available for this
                  listing.
                </TooltipContent>
              </Tooltip>
            )}
          </aside>
        </div>
      </CardContent>
    </Card>
  );
}
