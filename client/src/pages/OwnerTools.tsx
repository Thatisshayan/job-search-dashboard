import ScoreBreakdown from "@/components/ScoreBreakdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useIsOwner } from "@/hooks/useIsOwner";
import { trpc } from "@/lib/trpc";
import { CircleAlert, PlusCircle, ShieldAlert, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type ListingForm = {
  sourceName: string;
  sourcePostingUrl: string;
  originalApplyUrl: string;
  title: string;
  employer: string;
  location: string;
  description: string;
  postedAt: string;
  seniorityMatch: "strong" | "partial" | "weak";
  verificationNote: string;
};

const blankListing: ListingForm = {
  sourceName: "",
  sourcePostingUrl: "",
  originalApplyUrl: "",
  title: "",
  employer: "",
  location: "Toronto, Ontario",
  description: "",
  postedAt: new Date().toISOString().slice(0, 10),
  seniorityMatch: "partial",
  verificationNote: "",
};

type PreviewForm = {
  title: string;
  description: string;
  location: string;
  seniorityMatch: "strong" | "partial" | "weak";
  skillMatches: string;
};

const blankPreview: PreviewForm = {
  title: "",
  description: "",
  location: "Toronto, Ontario",
  seniorityMatch: "partial",
  skillMatches: "",
};

export default function OwnerTools() {
  const { isOwner, isLoading } = useIsOwner();

  if (isLoading)
    return (
      <div className="mx-auto max-w-5xl">
        <div className="h-96 animate-pulse rounded-2xl bg-muted" />
      </div>
    );

  if (!isOwner) {
    return (
      <div className="mx-auto max-w-3xl">
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-4 p-12 text-center">
            <ShieldAlert className="h-10 w-10 text-muted-foreground" />
            <h1 className="text-xl font-bold">Owner tools</h1>
            <p className="text-sm text-muted-foreground">
              These tools (adding verified listings and previewing scores) are
              restricted to the dashboard owner.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
          Owner tools
        </p>
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
          Add listings and preview scores
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Import a verified listing from an authorized source, or test how the
          scoring engine would rate a job before importing it.
        </p>
      </header>
      <AddListingCard />
      <ScorePreviewCard />
    </div>
  );
}

function AddListingCard() {
  const [form, setForm] = useState<ListingForm>(blankListing);
  const utils = trpc.useUtils();
  const mutation = trpc.dashboard.importVerifiedListings.useMutation({
    onSuccess: () => {
      utils.dashboard.overview.invalidate();
      utils.dashboard.shortlist.invalidate();
      utils.dashboard.history.invalidate();
      toast.success("Listing imported and scored");
      setForm(blankListing);
    },
    onError: error =>
      toast.error("Could not import listing", { description: error.message }),
  });

  const submit = () => {
    mutation.mutate({
      listings: [
        {
          sourceName: form.sourceName,
          sourcePostingUrl: form.sourcePostingUrl,
          originalApplyUrl: form.originalApplyUrl,
          title: form.title,
          employer: form.employer,
          location: form.location,
          employmentType: "full-time",
          description: form.description,
          postedAt: new Date(form.postedAt),
          seniorityMatch: form.seniorityMatch,
          verificationNote: form.verificationNote,
        },
      ],
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PlusCircle className="h-5 w-5 text-primary" />
          Add a verified listing
        </CardTitle>
        <CardDescription>
          Only listings from an authorized source with a real original
          application link should be added here.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <Field label="Source name">
          <Input
            value={form.sourceName}
            onChange={e => setForm({ ...form, sourceName: e.target.value })}
            placeholder="Government of Canada Job Bank"
          />
        </Field>
        <Field label="Employer">
          <Input
            value={form.employer}
            onChange={e => setForm({ ...form, employer: e.target.value })}
          />
        </Field>
        <Field label="Job title">
          <Input
            value={form.title}
            onChange={e => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label="Location">
          <Input
            value={form.location}
            onChange={e => setForm({ ...form, location: e.target.value })}
          />
        </Field>
        <Field label="Source posting URL">
          <Input
            value={form.sourcePostingUrl}
            onChange={e =>
              setForm({ ...form, sourcePostingUrl: e.target.value })
            }
            placeholder="https://..."
          />
        </Field>
        <Field label="Original apply URL">
          <Input
            value={form.originalApplyUrl}
            onChange={e =>
              setForm({ ...form, originalApplyUrl: e.target.value })
            }
            placeholder="https://..."
          />
        </Field>
        <Field label="Posted date">
          <Input
            type="date"
            value={form.postedAt}
            onChange={e => setForm({ ...form, postedAt: e.target.value })}
          />
        </Field>
        <Field label="Seniority match">
          <Select
            value={form.seniorityMatch}
            onValueChange={value =>
              setForm({
                ...form,
                seniorityMatch: value as ListingForm["seniorityMatch"],
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="strong">Strong</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="weak">Weak</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="md:col-span-2">
          <Field label="Description (min 80 characters)">
            <Textarea
              className="min-h-28"
              value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
            />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Field label="Verification note (min 20 characters — how you confirmed this is authorized and current)">
            <Textarea
              value={form.verificationNote}
              onChange={e =>
                setForm({ ...form, verificationNote: e.target.value })
              }
            />
          </Field>
        </div>
        <div className="md:col-span-2">
          <Button onClick={submit} disabled={mutation.isPending}>
            {mutation.isPending ? "Importing…" : "Import listing"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ScorePreviewCard() {
  const [form, setForm] = useState<PreviewForm>(blankPreview);
  const [submitted, setSubmitted] = useState<PreviewForm | null>(null);
  const preview = trpc.dashboard.previewScore.useQuery(
    submitted
      ? {
          title: submitted.title,
          description: submitted.description,
          location: submitted.location,
          seniorityMatch: submitted.seniorityMatch,
          skillMatches: submitted.skillMatches
            .split(",")
            .map(s => s.trim())
            .filter(Boolean),
          employmentType: "full-time",
        }
      : { title: "", description: "" },
    { enabled: Boolean(submitted) }
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Preview a score
        </CardTitle>
        <CardDescription>
          Test how the scoring engine would rate a job description before
          deciding whether to import it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Job title">
            <Input
              value={form.title}
              onChange={e => setForm({ ...form, title: e.target.value })}
            />
          </Field>
          <Field label="Location">
            <Input
              value={form.location}
              onChange={e => setForm({ ...form, location: e.target.value })}
            />
          </Field>
          <Field label="Seniority match">
            <Select
              value={form.seniorityMatch}
              onValueChange={value =>
                setForm({
                  ...form,
                  seniorityMatch: value as PreviewForm["seniorityMatch"],
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="strong">Strong</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="weak">Weak</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Matched resume skills (comma separated)">
            <Input
              value={form.skillMatches}
              onChange={e => setForm({ ...form, skillMatches: e.target.value })}
              placeholder="MS Project, budget tracking"
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Description">
              <Textarea
                className="min-h-28"
                value={form.description}
                onChange={e =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </Field>
          </div>
        </div>
        <Button
          variant="outline"
          onClick={() => setSubmitted(form)}
          disabled={!form.title || !form.description}
        >
          Preview score
        </Button>

        {submitted && preview.data && (
          <div className="grid gap-6 rounded-2xl border bg-muted/25 p-5 md:grid-cols-[1fr_260px]">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-data">
                  {preview.data.totalScore}/100
                </Badge>
                <p className="text-sm font-semibold">
                  {preview.data.totalScore >= 80
                    ? "Strong match"
                    : preview.data.totalScore >= 60
                      ? "Worth review"
                      : "Lower priority"}
                </p>
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">
                {preview.data.rationale}
              </p>
              {preview.data.notableGaps.length > 0 && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <div className="flex items-start gap-2">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                    <div>
                      <p className="text-xs font-bold uppercase tracking-wider text-amber-900">
                        Notable gaps
                      </p>
                      <ul className="mt-1 space-y-1 text-sm leading-5 text-amber-900">
                        {preview.data.notableGaps.map(gap => (
                          <li key={gap}>• {gap}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
            <ScoreBreakdown scorecard={preview.data} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-2">{children}</div>
    </div>
  );
}
