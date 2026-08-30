import { Progress } from "@/components/ui/progress";

export const scoreComponentDefinitions = [
  ["Role/title", "roleAlignment", 30],
  ["Resume skills", "resumeSkillMatch", 25],
  ["Seniority", "seniorityAlignment", 15],
  ["Location", "locationCommuteFit", 10],
  ["Quality", "employmentQualityFit", 10],
  ["Recency", "recencyReadiness", 10],
] as const;

export type ScoreBreakdownData = {
  roleAlignment: number;
  resumeSkillMatch: number;
  seniorityAlignment: number;
  locationCommuteFit: number;
  employmentQualityFit: number;
  recencyReadiness: number;
  penalties: number;
};

export default function ScoreBreakdown({
  scorecard,
}: {
  scorecard: ScoreBreakdownData;
}) {
  return (
    <div className="space-y-3">
      {scoreComponentDefinitions.map(([label, key, maximum]) => {
        const value = scorecard[key];
        return (
          <div key={key}>
            <div className="mb-1.5 flex justify-between text-xs">
              <span className="font-medium text-foreground">{label}</span>
              <span className="font-data text-muted-foreground">
                {value}/{maximum}
              </span>
            </div>
            <Progress value={(value / maximum) * 100} className="h-1.5" />
          </div>
        );
      })}
      {scorecard.penalties !== 0 && (
        <p className="border-t pt-3 text-xs font-semibold text-destructive">
          Penalties: {scorecard.penalties} points
        </p>
      )}
    </div>
  );
}
