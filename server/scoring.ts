export const SCORE_WEIGHTS = {
  roleAlignment: 30,
  resumeSkillMatch: 25,
  seniorityAlignment: 15,
  locationCommuteFit: 10,
  employmentQualityFit: 10,
  recencyReadiness: 10,
} as const;

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

const exactTitles = [
  "construction coordinator",
  "construction co-ordinator",
  "project coordinator",
  "project co-ordinator",
  "estimator",
  "project manager",
  "construction project manager",
  "construction manager",
  "construction site manager",
  "site superintendent",
  "preconstruction coordinator",
  "preconstruction manager",
  "assistant project manager",
];

const relatedTitleTerms = ["construction", "preconstruction", "estimator", "superintendent", "project"];

function normalized(value?: string | null) {
  return (value ?? "").trim().toLowerCase();
}

function isGtaLocation(location?: string | null, locationKm?: number | null) {
  if (typeof locationKm === "number") return locationKm <= 75;
  const locationText = normalized(location);
  return ["toronto", "mississauga", "brampton", "vaughan", "markham", "richmond hill", "oakville", "burlington", "milton", "pickering", "ajax", "whitby", "oshawa", "scarborough", "etobicoke", "gta"].some(
    term => locationText.includes(term),
  );
}

function daysOld(postedAt?: Date | null) {
  if (!postedAt) return 30;
  return Math.max(0, Math.floor((Date.now() - postedAt.getTime()) / 86_400_000));
}

export function scoreJob(input: ScoreInput): ScoreResult {
  const title = normalized(input.title);
  const description = normalized(input.description);
  const fullTime = normalized(input.employmentType).includes("full");
  const hasApplyLink = Boolean(input.originalApplyUrl?.startsWith("http"));
  const isExpired = input.status === "expired" || input.status === "unavailable" || input.status === "stale" || Boolean(input.expiresAt && input.expiresAt.getTime() < Date.now());
  const gta = isGtaLocation(input.location, input.locationKm);
  const titleIsExact = exactTitles.some(candidate => title.includes(candidate));
  const titleIsRelated = relatedTitleTerms.filter(term => title.includes(term)).length >= 2;

  const roleAlignment = titleIsExact ? SCORE_WEIGHTS.roleAlignment : titleIsRelated ? 18 : 0;
  const skillMatches = Array.from(new Set(input.skillMatches ?? []));
  const resumeSkillMatch = Math.min(SCORE_WEIGHTS.resumeSkillMatch, skillMatches.length * 5);
  const seniorityAlignment = input.seniorityMatch === "strong" ? 15 : input.seniorityMatch === "partial" ? 8 : 0;
  const locationCommuteFit = gta ? SCORE_WEIGHTS.locationCommuteFit : 0;
  const employmentQualityFit = (fullTime ? 4 : 0) + (hasApplyLink ? 4 : 0) + (description.length >= 300 ? 2 : 0);

  const age = daysOld(input.postedAt);
  const recencyReadiness = isExpired ? 0 : age <= 3 ? 10 : age <= 7 ? 8 : age <= 14 ? 5 : 2;

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
  if (!gta) {
    penalties -= 30;
    gaps.push("The listed location is outside the configured 75 km GTA radius or cannot be verified.");
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
    { category: "Role/title alignment", points: roleAlignment, detail: titleIsExact ? "The job title directly matches a configured construction target role." : titleIsRelated ? "The title has related construction project terminology." : "The title does not match a configured role family." },
    { category: "Resume skill match", points: resumeSkillMatch, detail: skillMatches.length ? `Matched resume evidence: ${skillMatches.join(", ")}.` : "No verified resume skill matches were supplied." },
    { category: "Seniority alignment", points: seniorityAlignment, detail: input.seniorityMatch === "strong" ? "Experience requirements align strongly with verified project-management evidence." : input.seniorityMatch === "partial" ? "Some seniority evidence aligns, but the requirement should be reviewed." : "No verified seniority alignment was established." },
    { category: "Location/commute fit", points: locationCommuteFit, detail: gta ? "The job is within the configured Toronto/GTA search area." : "The job is outside the configured GTA search area or the location is unclear." },
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
