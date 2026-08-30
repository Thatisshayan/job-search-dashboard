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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useIsOwner } from "@/hooks/useIsOwner";
import { trpc } from "@/lib/trpc";
import {
  Award,
  BriefcaseBusiness,
  FileCheck2,
  GraduationCap,
  Pencil,
  Save,
  ShieldCheck,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function ResumeProfile() {
  const { isOwner } = useIsOwner();
  const profile = trpc.dashboard.profile.useQuery();
  const utils = trpc.useUtils();
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState({ headline: "", location: "", summary: "" });
  const mutation = trpc.dashboard.updateProfile.useMutation({
    onSuccess: () => {
      utils.dashboard.profile.invalidate();
      toast.success("Profile updated");
      setIsEditing(false);
    },
    onError: error =>
      toast.error("Could not update profile", { description: error.message }),
  });

  if (profile.isLoading)
    return (
      <div className="mx-auto max-w-6xl space-y-5">
        <Skeleton className="h-28 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  const data = profile.data;
  if (!data) return null;
  const skills = Object.entries(data.skills ?? {}) as Array<[string, string[]]>;
  const experience = (data.experience ?? []) as Array<{
    employer?: string;
    title?: string;
    period?: string;
    evidence?: string[];
  }>;
  const education = (data.education ?? []) as Array<{
    degree?: string;
    institution?: string;
    year?: number;
  }>;

  const startEditing = () => {
    setForm({
      headline: data.headline,
      location: data.location,
      summary: data.summary,
    });
    setIsEditing(true);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <header className="overflow-hidden rounded-3xl border bg-card shadow-[0_14px_40px_rgba(18,57,69,0.07)]">
        <div className="paper-grid px-6 py-8 md:px-9">
          <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">
                Verified matching profile
              </p>
              {isEditing ? (
                <div className="mt-3 space-y-3">
                  <div>
                    <Label htmlFor="headline">Headline</Label>
                    <Input
                      id="headline"
                      className="mt-1"
                      value={form.headline}
                      onChange={e =>
                        setForm({ ...form, headline: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="location">Location</Label>
                    <Input
                      id="location"
                      className="mt-1"
                      value={form.location}
                      onChange={e =>
                        setForm({ ...form, location: e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="summary">Summary</Label>
                    <Textarea
                      id="summary"
                      className="mt-1 min-h-28"
                      value={form.summary}
                      onChange={e =>
                        setForm({ ...form, summary: e.target.value })
                      }
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate(form)}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      Save
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setIsEditing(false)}
                    >
                      <X className="mr-2 h-4 w-4" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <h1 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">
                    {data.displayName} — {data.headline}
                  </h1>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
                    {data.summary}
                  </p>
                  {isOwner && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-4"
                      onClick={startEditing}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Edit profile
                    </Button>
                  )}
                </>
              )}
            </div>
            <div className="rounded-2xl border border-primary/15 bg-card/80 px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Resume in use
              </p>
              <p className="mt-1 flex items-center gap-2 text-sm font-semibold">
                <FileCheck2 className="h-4 w-4 text-primary" />
                {data.resumeLabel}
              </p>
            </div>
          </div>
        </div>
      </header>
      <div className="mt-7 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Award className="h-5 w-5 text-primary" />
              Verified skills & tools
            </CardTitle>
            <CardDescription>
              Only these extracted skills contribute evidence to match
              explanations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {skills.map(([category, values]) => (
              <div key={category}>
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  {category.replace(/([A-Z])/g, " $1")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {values.map(value => (
                    <Badge
                      key={value}
                      variant="secondary"
                      className="bg-muted px-2.5 py-1 text-foreground"
                    >
                      {value}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Scoring guardrails
            </CardTitle>
            <CardDescription>
              Evidence-based matching means the system does not overstate
              qualifications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
              {(data.scoringGuardrails ?? []).map(rule => (
                <li key={rule} className="flex gap-3">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {rule}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BriefcaseBusiness className="h-5 w-5 text-primary" />
              Experience evidence
            </CardTitle>
            <CardDescription>
              Source facts used to assess seniority, scope, coordination, and
              construction relevance.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            {experience.map(role => (
              <div
                key={`${role.employer}-${role.title}`}
                className="rounded-2xl border bg-muted/25 p-5"
              >
                <p className="text-base font-bold">{role.title}</p>
                <p className="mt-1 text-sm font-semibold text-primary">
                  {role.employer}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {role.period}
                </p>
                <ul className="mt-4 space-y-2 text-sm leading-5 text-muted-foreground">
                  {role.evidence?.map(item => (
                    <li key={item}>• {item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-primary" />
              Education
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {education.map(item => (
              <div
                key={`${item.degree}-${item.year}`}
                className="rounded-xl border p-4"
              >
                <p className="font-semibold">{item.degree}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {item.institution} · {item.year}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
