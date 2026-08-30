import JobCard from "@/components/JobCard";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsOwner } from "@/hooks/useIsOwner";
import { trpc } from "@/lib/trpc";
import { History, RotateCw, ShieldCheck, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

const trendChartConfig: ChartConfig = {
  averageScore: { label: "Average fit score", color: "var(--primary)" },
  shortlistCount: { label: "Shortlist size", color: "var(--muted-foreground)" },
};

const actionFilterOptions = [
  ["all", "All statuses"],
  ["none", "No action yet"],
  ["saved", "Saved"],
  ["opened", "Opened"],
  ["applied", "Applied"],
  ["not_interested", "Not interested"],
  ["reported_stale", "Reported stale"],
] as const;

function formatTimestamp(value: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Toronto",
  }).format(new Date(value));
}

export default function JobHistory() {
  const { isOwner } = useIsOwner();
  const history = trpc.dashboard.history.useQuery();
  const runs = trpc.dashboard.runs.useQuery();
  const utils = trpc.useUtils();
  const dates = useMemo(
    () =>
      Array.from(new Set((history.data ?? []).map(item => item.entry.dateKey)))
        .sort()
        .reverse(),
    [history.data]
  );
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  useEffect(() => {
    if (!selectedDate && dates[0]) setSelectedDate(dates[0]);
  }, [dates, selectedDate]);
  const selectedEntries = useMemo(() => {
    let scoped = selectedDate
      ? (history.data ?? []).filter(item => item.entry.dateKey === selectedDate)
      : (history.data ?? []);
    const query = search.trim().toLowerCase();
    if (query)
      scoped = scoped.filter(
        item =>
          item.job.title.toLowerCase().includes(query) ||
          item.job.employer.toLowerCase().includes(query)
      );
    if (statusFilter !== "all")
      scoped = scoped.filter(
        item => (item.action?.status ?? "none") === statusFilter
      );
    return scoped;
  }, [history.data, selectedDate, search, statusFilter]);
  const lastSuccess = runs.data?.find(run => run.status === "completed");

  const trendData = useMemo(() => {
    const byDate = new Map<string, { total: number; count: number }>();
    for (const item of history.data ?? []) {
      const bucket = byDate.get(item.entry.dateKey) ?? { total: 0, count: 0 };
      bucket.total += item.scorecard.totalScore;
      bucket.count += 1;
      byDate.set(item.entry.dateKey, bucket);
    }
    const shortlistByDate = new Map<string, number>();
    for (const run of runs.data ?? []) {
      const dateKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Toronto",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(run.startedAt));
      shortlistByDate.set(dateKey, run.shortlistCount);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dateKey, { total, count }]) => ({
        dateKey,
        averageScore: Math.round(total / count),
        shortlistCount: shortlistByDate.get(dateKey) ?? count,
      }));
  }, [history.data, runs.data]);

  const setActionMutation = trpc.dashboard.setAction.useMutation({
    onSuccess: () => utils.dashboard.history.invalidate(),
    onError: error =>
      toast.error("Could not update job status", {
        description: error.message,
      }),
  });
  const prepareApplicationMutation =
    trpc.dashboard.prepareApplication.useMutation({
      onSuccess: () => {
        utils.dashboard.history.invalidate();
        toast.success("Sent for Telegram review", {
          description: "Check Telegram to approve or decline this application.",
        });
      },
      onError: error =>
        toast.error("Could not prepare application", {
          description: error.message,
        }),
    });

  return (
    <div className="mx-auto max-w-7xl">
      <header className="mb-7">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
          Activity record
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
          Job history
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Review past shortlists and the outcome of every daily collection run.
        </p>
      </header>
      <section className="mb-9">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <RotateCw className="h-4 w-4 text-primary" />
            <h2 className="font-bold">Daily run history</h2>
          </div>
          <p className="text-xs text-muted-foreground">
            Last successful refresh:{" "}
            <span className="font-medium text-foreground">
              {lastSuccess
                ? formatTimestamp(
                    lastSuccess.completedAt ?? lastSuccess.startedAt
                  )
                : "Not yet recorded"}
            </span>
          </p>
        </div>
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="hidden grid-cols-[1.35fr_repeat(6,0.72fr)] gap-4 border-b bg-muted/45 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground lg:grid">
              <span>Run time</span>
              <span>Status</span>
              <span>Sources</span>
              <span>Collected</span>
              <span>Merged</span>
              <span>Scored</span>
              <span>Shortlist</span>
            </div>
            {runs.isLoading ? (
              <div className="p-5">
                <Skeleton className="h-12" />
              </div>
            ) : runs.data?.length ? (
              runs.data.map(run => (
                <div
                  key={run.id}
                  className="grid gap-2 border-b px-5 py-4 text-sm last:border-0 lg:grid-cols-[1.35fr_repeat(6,0.72fr)] lg:items-center"
                >
                  <span className="font-medium">
                    {formatTimestamp(run.startedAt)}
                  </span>
                  <span>
                    <Badge
                      variant={
                        run.status === "completed" ? "secondary" : "outline"
                      }
                    >
                      {run.status}
                    </Badge>
                  </span>
                  <span>{run.sourcesChecked}</span>
                  <span>{run.listingsCollected}</span>
                  <span>{run.duplicatesMerged}</span>
                  <span>{run.jobsScored}</span>
                  <span className="font-data font-medium">
                    {run.shortlistCount}
                  </span>
                  {run.errorSummary && (
                    <p className="text-xs text-destructive lg:col-span-7">
                      {run.errorSummary}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground">
                <ShieldCheck className="h-5 w-5 text-primary" />
                No daily runs have been recorded yet. The run log starts
                automatically after the first authorized refresh.
              </div>
            )}
          </CardContent>
        </Card>
      </section>
      {trendData.length > 1 && (
        <section className="mb-9">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <TrendingUp className="h-4 w-4 text-primary" />
                Trends
              </CardTitle>
              <CardDescription>
                Average fit score and shortlist size across your recorded
                history.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={trendChartConfig} className="h-64 w-full">
                <LineChart
                  data={trendData}
                  margin={{ left: 4, right: 12, top: 8, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="dateKey"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <YAxis tickLine={false} axisLine={false} width={32} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line
                    type="monotone"
                    dataKey="averageScore"
                    stroke="var(--color-averageScore)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="shortlistCount"
                    stroke="var(--color-shortlistCount)"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </section>
      )}
      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-primary" />
            <h2 className="font-bold">Past shortlisted roles</h2>
          </div>
          {dates.length > 0 && (
            <div className="flex max-w-full gap-2 overflow-x-auto pb-1">
              {dates.map(date => (
                <button
                  key={date}
                  onClick={() => setSelectedDate(date)}
                  className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${selectedDate === date ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-primary/40"}`}
                >
                  {date}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Filter by title or employer…"
            className="w-full max-w-sm rounded-lg border bg-card px-3 py-2 text-sm outline-none ring-primary/30 focus:ring-2"
          />
          {isOwner && (
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full max-w-[220px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {actionFilterOptions.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        {history.isLoading ? (
          <Skeleton className="h-72 rounded-2xl" />
        ) : selectedEntries.length ? (
          <div className="space-y-5">
            {selectedEntries.map(item => (
              <JobCard
                key={item.entry.id}
                item={item}
                owner={{
                  isOwner,
                  onSetAction: status =>
                    setActionMutation.mutate({ jobId: item.job.id, status }),
                  isSettingAction: setActionMutation.isPending,
                  onPrepareApplication: () =>
                    prepareApplicationMutation.mutate({ jobId: item.job.id }),
                  isPreparingApplication: prepareApplicationMutation.isPending,
                }}
              />
            ))}
          </div>
        ) : (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              {search
                ? "No past roles match that search."
                : "Previously shortlisted roles will appear here after your first daily job refresh."}
            </CardContent>
          </Card>
        )}
      </section>
    </div>
  );
}
