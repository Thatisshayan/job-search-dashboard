import JobCard from "@/components/JobCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsOwner } from "@/hooks/useIsOwner";
import { trpc } from "@/lib/trpc";
import {
  CalendarClock,
  ChevronRight,
  CircleCheck,
  FileSearch,
  Settings2,
  Sparkles,
} from "lucide-react";
import { useLocation } from "wouter";
import { toast } from "sonner";

function displayToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

export default function Home() {
  const [, setLocation] = useLocation();
  const { isOwner } = useIsOwner();
  const overview = trpc.dashboard.overview.useQuery();
  const shortlist = trpc.dashboard.shortlist.useQuery({});
  const utils = trpc.useUtils();
  const jobs = shortlist.data ?? [];
  const enabledSources =
    overview.data?.sources.filter(source => source.enabled).length ?? 0;

  const setActionMutation = trpc.dashboard.setAction.useMutation({
    onSuccess: () => utils.dashboard.shortlist.invalidate(),
    onError: error =>
      toast.error("Could not update job status", {
        description: error.message,
      }),
  });
  const prepareApplicationMutation =
    trpc.dashboard.prepareApplication.useMutation({
      onSuccess: () => {
        utils.dashboard.shortlist.invalidate();
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
      <header className="mb-7 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
            Daily shortlist
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
            Today’s best construction roles
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {displayToday()} · Toronto / GTA · full-time positions only
          </p>
        </div>
        <Button
          variant="outline"
          className="self-start border-primary/25 bg-card"
          onClick={() => setLocation("/settings")}
        >
          <Settings2 className="mr-2 h-4 w-4" />
          Search settings
        </Button>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric
          label="Today’s shortlist"
          value={shortlist.isLoading ? "—" : String(jobs.length)}
          caption="up to 20 top matches"
          icon={<Sparkles className="h-5 w-5" />}
        />
        <Metric
          label="Search radius"
          value={`${overview.data?.settings?.radiusKm ?? 75} km`}
          caption={overview.data?.settings?.city ?? "Toronto, Ontario"}
          icon={<FileSearch className="h-5 w-5" />}
        />
        <Metric
          label="Active sources"
          value={overview.isLoading ? "—" : String(enabledSources)}
          caption="authorized sources only"
          icon={<CircleCheck className="h-5 w-5" />}
        />
        <Metric
          label="Next refresh"
          value={overview.data?.settings?.scheduledTime ?? "07:30"}
          caption="America/Toronto daily"
          icon={<CalendarClock className="h-5 w-5" />}
        />
      </section>

      <section className="mt-8">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold">Match queue</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Transparent scoring and original-site application links.
            </p>
          </div>
          {overview.data?.latestRun && (
            <Badge variant="outline" className="font-data text-[11px]">
              Last run: {overview.data.latestRun.status}
            </Badge>
          )}
        </div>
        {shortlist.isLoading ? (
          <div className="space-y-4">
            {[1, 2].map(value => (
              <Skeleton key={value} className="h-72 w-full rounded-2xl" />
            ))}
          </div>
        ) : jobs.length ? (
          <div className="space-y-5">
            {jobs.map(item => (
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
          <EmptyShortlist
            onSettings={() => setLocation("/settings")}
            sourceCount={enabledSources}
          />
        )}
      </section>
    </div>
  );
}

function Metric({
  label,
  value,
  caption,
  icon,
}: {
  label: string;
  value: string;
  caption: string;
  icon: React.ReactNode;
}) {
  return (
    <Card className="border-border/90 bg-card shadow-[0_8px_24px_rgba(18,57,69,0.045)]">
      <CardContent className="flex items-start justify-between p-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{caption}</p>
        </div>
        <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
          {icon}
        </div>
      </CardContent>
    </Card>
  );
}

function EmptyShortlist({
  onSettings,
  sourceCount,
}: {
  onSettings: () => void;
  sourceCount: number;
}) {
  return (
    <Card className="paper-grid overflow-hidden border-dashed bg-card">
      <CardContent className="flex min-h-[370px] flex-col items-center justify-center px-6 py-14 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <FileSearch className="h-7 w-7" />
        </div>
        <h3 className="mt-5 text-xl font-bold">
          Your first live shortlist is waiting on an authorized source
          connection
        </h3>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Your verified resume profile and GTA filters are ready. The dashboard
          will publish only active, full-time roles with evidence-backed scores
          and direct original application links.{" "}
          {sourceCount
            ? "Configure a permitted data source to enable the first refresh."
            : "Enable an authorized source to begin."}
        </p>
        <Button className="mt-6" onClick={onSettings}>
          Review source settings
          <ChevronRight className="ml-2 h-4 w-4" />
        </Button>
      </CardContent>
    </Card>
  );
}
