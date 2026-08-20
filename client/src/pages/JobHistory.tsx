import JobCard from "@/components/JobCard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trpc } from "@/lib/trpc";
import { History, RotateCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function formatTimestamp(value: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Toronto" }).format(new Date(value));
}

export default function JobHistory() {
  const history = trpc.dashboard.history.useQuery();
  const runs = trpc.dashboard.runs.useQuery();
  const dates = useMemo(() => Array.from(new Set((history.data ?? []).map(item => item.entry.dateKey))).sort().reverse(), [history.data]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  useEffect(() => { if (!selectedDate && dates[0]) setSelectedDate(dates[0]); }, [dates, selectedDate]);
  const selectedEntries = selectedDate ? (history.data ?? []).filter(item => item.entry.dateKey === selectedDate) : history.data ?? [];
  const lastSuccess = runs.data?.find(run => run.status === "completed");
  return <div className="mx-auto max-w-7xl"><header className="mb-7"><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Activity record</p><h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">Job history</h1><p className="mt-2 text-sm text-muted-foreground">Review past shortlists and the outcome of every daily collection run.</p></header>
    <section className="mb-9"><div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><RotateCw className="h-4 w-4 text-primary" /><h2 className="font-bold">Daily run history</h2></div><p className="text-xs text-muted-foreground">Last successful refresh: <span className="font-medium text-foreground">{lastSuccess ? formatTimestamp(lastSuccess.completedAt ?? lastSuccess.startedAt) : "Not yet recorded"}</span></p></div><Card className="overflow-hidden"><CardContent className="p-0"><div className="hidden grid-cols-[1.35fr_repeat(6,0.72fr)] gap-4 border-b bg-muted/45 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground lg:grid"><span>Run time</span><span>Status</span><span>Sources</span><span>Collected</span><span>Merged</span><span>Scored</span><span>Shortlist</span></div>{runs.isLoading ? <div className="p-5"><Skeleton className="h-12" /></div> : runs.data?.length ? runs.data.map(run => <div key={run.id} className="grid gap-2 border-b px-5 py-4 text-sm last:border-0 lg:grid-cols-[1.35fr_repeat(6,0.72fr)] lg:items-center"><span className="font-medium">{formatTimestamp(run.startedAt)}</span><span><Badge variant={run.status === "completed" ? "secondary" : "outline"}>{run.status}</Badge></span><span>{run.sourcesChecked}</span><span>{run.listingsCollected}</span><span>{run.duplicatesMerged}</span><span>{run.jobsScored}</span><span className="font-data font-medium">{run.shortlistCount}</span>{run.errorSummary && <p className="text-xs text-destructive lg:col-span-7">{run.errorSummary}</p>}</div>) : <div className="flex items-center gap-3 p-6 text-sm text-muted-foreground"><ShieldCheck className="h-5 w-5 text-primary" />No daily runs have been recorded yet. The run log starts automatically after the first authorized refresh.</div>}</CardContent></Card></section>
    <section><div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /><h2 className="font-bold">Past shortlisted roles</h2></div>{dates.length > 0 && <div className="flex max-w-full gap-2 overflow-x-auto pb-1">{dates.map(date => <button key={date} onClick={() => setSelectedDate(date)} className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${selectedDate === date ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:border-primary/40"}`}>{date}</button>)}</div>}</div>{history.isLoading ? <Skeleton className="h-72 rounded-2xl" /> : selectedEntries.length ? <div className="space-y-5">{selectedEntries.map(item => <JobCard key={item.entry.id} item={item} />)}</div> : <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Previously shortlisted roles will appear here after your first daily job refresh.</CardContent></Card>}</section></div>;
}
