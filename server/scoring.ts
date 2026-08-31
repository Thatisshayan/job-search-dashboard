export const SCORE_WEIGHTS = {
  roleAlignment: 30,
  resumeSkillMatch: 25,
  seniorityAlignment: 15,
  locationCommuteFit: 10,
  employmentQualityFit: 10,
  recencyReadiness: 10,
} as const;

const DEFAULT_RADIUS_KM = 75;

// Generic English stopwords plus job-posting boilerplate words that would
// otherwise dominate the "related title" word-overlap check regardless of
// the user's actual target roles (e.g. "Senior X Manager" and "X Assistant"
// would falsely look related purely because they share "manager"/generic terms).
const TITLE_STOPWORDS = new Set([
  "and", "or", "the", "a", "an", "of", "for", "in", "at", "to",
  "senior", "junior", "assistant", "associate", "lead", "level", "i", "ii", "iii",
]);

export type ScoreInput = {
  title: string;
  description: string;
  employmentType?: string | null;
  location?: string | null;
  locationKm?: number | null;
  originalApplyUrl?: string | null;
  postedAt?: Date | null;
  expiresAt?: Date | null;
  status?: "active" | "expired" | "unavailable" | "stale";
  skillMatches?: string[];
  seniorityMatch?: "strong" | "partial" | "weak";
  isDuplicate?: boolean;
  /** The user's configured target job titles (searchSettings.targetTitles). */
  targetTitles?: string[];
  /** The user's configured search center (searchSettings.city), used only as a
   * fallback text match when a real distance (locationKm) isn't available. */
  targetCity?: string | null;
  /** The user's configured search radius in km (searchSettings.radiusKm). */
  targetRadiusKm?: number | null;
};

export type ScoreResult = {
  roleAlignment: number;
  resumeSkillMatch: number;
  seniorityAlignment: number;
  locationCommuteFit: number;
  employmentQualityFit: number;
  recencyReadiness: number;
  penalties: number;
  totalScore: number;
  rationale: string;
  notableGaps: string[];
  evidence: Array<{ category: string; points: number; detail: string }>;
};

function normalized(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function significantWords(value: string): string[] {
  return normalized(value)
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 2 && !TITLE_STOPWORDS.has(word));
}

/**
 * Matches the job title against the user's configured target titles. "Exact"
 * means the job title contains one of the target titles verbatim (normalized).
 * "Related" is a looser signal: the job title shares at least two significant
 * words with any single target title (e.g. target "Construction Coordinator"
 * vs. job title "Junior Construction Site Coordinator" shares "construction"
 * and "coordinator").
 */
function matchTitle(jobTitle: string, targetTitles: string[] | undefined) {
  const title = normalized(jobTitle);
  const targets = (targetTitles ?? []).map(normalized).filter(Boolean);
  if (targets.length === 0) return { exact: false, related: false };

  const exact = targets.some(target => title.includes(target));
  if (exact) return { exact: true, related: true };

  const titleWords = new Set(significantWords(jobTitle));
  const related = targets.some(target => {
    const overlap = significantWords(target).filter(word => titleWords.has(word)).length;
    return overlap >= 2;
  });
  return { exact: false, related };
}

/**
 * Whether the job is within the user's configured search radius. Prefers a
 * real distance (locationKm, computed upstream) when available; otherwise
 * falls back to a plain substring/word-overlap match against the configured
 * city, which is a coarse heuristic (no geocoding in this phase — a job in a
 * same-named-but-distant place, or an unnamed nearby suburb, can be
 * mis-classified either way). Revisit once real geocoding is available.
 */
function isWithinTargetRadius(location: string | null | undefined, locationKm: number | null | undefined, targetCity: string | null | undefined, targetRadiusKm: number | null | undefined) {
  const radius = targetRadiusKm ?? DEFAULT_RADIUS_KM;
  if (typeof locationKm === "number") return locationKm <= radius;

  // Compare city-name segments only (text before the first comma), not the
  // full "City, Province/State" string — otherwise two different cities in
  // the same province/state (e.g. "Ottawa, Ontario" vs. "Toronto, Ontario")
  // would falsely match on the shared province name.
  const cityName = normalized(targetCity).split(",")[0]?.trim();
  const locationCityName = normalized(location).split(",")[0]?.trim();
  if (!cityName || !locationCityName) return false;

  return locationCityName === cityName || locationCityName.includes(cityName) || cityName.includes(locationCityName);
}

function daysOld(postedAt?: Date | null) {
  if (!postedAt) return 30;
  return Math.max(0, Math.floor((Date.now() - postedAt.getTime()) / 86_400_000));
}

export function scoreJob(input: ScoreInput): ScoreResult {
  const description = normalized(input.description);
  const fullTime = normalized(input.employmentType).includes("full");
  const hasApplyLink = Boolean(input.originalApplyUrl?.startsWith("http"));
  const isExpired = input.status === "expired" || input.status === "unavailable" || input.status === "stale" || Boolean(input.expiresAt && input.expiresAt.getTime() < Date.now());
  const withinRadius = isWithinTargetRadius(input.location, input.locationKm, input.targetCity, input.targetRadiusKm);
  const { exact: titleIsExact, related: titleIsRelated } = matchTitle(input.title, input.targetTitles);

  const roleAlignment = titleIsExact ? SCORE_WEIGHTS.roleAlignment : titleIsRelated ? 18 : 0;
  const skillMatches = Array.from(new Set(input.skillMatches ?? []));
  const resumeSkillMatch = Math.min(SCORE_WEIGHTS.resumeSkillMatch, skillMatches.length * 5);
  const seniorityAlignment = input.seniorityMatch === "strong" ? 15 : input.seniorityMatch === "partial" ? 8 : 0;
  const locationCommuteFit = withinRadius ? SCORE_WEIGHTS.locationCommuteFit : 0;
  const employmentQualityFit = (fullTime ? 4 : 0) + (hasApplyLink ? 4 : 0) + (description.length >= 300 ? 2 : 0);

  const age = daysOld(input.postedAt);
  const recencyReadiness = isExpired ? 0 : age <= 3 ? 10 : age <= 7 ? 8 : age <= 14 ? 5 : 2;

  const radiusLabel = input.targetRadiusKm ?? DEFAULT_RADIUS_KM;
  let penalties = 0;
  const gaps: string[] = [];
  if (!hasApplyLink) {
    penalties -= 15;
    gaps.push("No original application link was supplied.");
  }
  if (!fullTime) {
    penalties -= 25;
    gaps.push("The listing is not identified as full-time.");
  }
  if (!withinRadius) {
    penalties -= 30;
    gaps.push(`The listed location is outside the configured ${radiusLabel} km search radius or cannot be verified.`);
  }
  if (isExpired) {
    penalties -= 40;
    gaps.push("The listing appears expired, unavailable, or stale.");
  }
  if (input.isDuplicate) {
    penalties -= 10;
    gaps.push("The listing duplicates another job record and should be merged before shortlist publication.");
  }

  const components = roleAlignment + resumeSkillMatch + seniorityAlignment + locationCommuteFit + employmentQualityFit + recencyReadiness;
  const totalScore = Math.max(0, Math.min(100, components + penalties));
  const evidence = [
    { category: "Role/title alignment", points: roleAlignment, detail: titleIsExact ? "The job title directly matches one of the configured target roles." : titleIsRelated ? "The title shares meaningful terminology with a configured target role." : "The title does not match any configured target role." },
    { category: "Resume skill match", points: resumeSkillMatch, detail: skillMatches.length ? `Matched resume evidence: ${skillMatches.join(", ")}.` : "No verified resume skill matches were supplied." },
    { category: "Seniority alignment", points: seniorityAlignment, detail: input.seniorityMatch === "strong" ? "Experience requirements align strongly with verified resume evidence." : input.seniorityMatch === "partial" ? "Some seniority evidence aligns, but the requirement should be reviewed." : "No verified seniority alignment was established." },
    { category: "Location/commute fit", points: locationCommuteFit, detail: withinRadius ? "The job is within the configured search area." : "The job is outside the configured search area or the location is unclear." },
    { category: "Employment type and job quality", points: employmentQualityFit, detail: `${fullTime ? "Full-time" : "Non-full-time or unspecified"}; ${hasApplyLink ? "original apply link available" : "no original apply link"}.` },
    { category: "Recency and application readiness", points: recencyReadiness, detail: isExpired ? "The job is not application-ready." : `Posted approximately ${age} day${age === 1 ? "" : "s"} ago.` },
  ];

  const positiveEvidence = evidence.filter(item => item.points > 0).map(item => item.detail);
  const rationale = positiveEvidence.length
    ? `Selected based on ${positiveEvidence.join(" ")}`
    : "The listing does not yet contain enough verified alignment evidence to recommend applying.";

  return {
    roleAlignment,
    resumeSkillMatch,
    seniorityAlignment,
    locationCommuteFit,
    employmentQualityFit,
    recencyReadiness,
    penalties,
    totalScore,
    rationale,
    notableGaps: gaps,
    evidence,
  };
}
