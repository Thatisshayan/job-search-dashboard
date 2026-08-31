import type { VerifiedListing } from "../verifiedListingImport";

/**
 * Second job-discovery source, added 2026-08-31 (see docs/telegram-agent/
 * DECISIONS.md D5's update note and ROADMAP.md Phase 10). Adzuna's
 * `redirect_url` never resolves to the employer's real apply page (it's
 * Adzuna's own click-tracked landing page, and their outbound click-through
 * endpoint actively blocks automated requests), so `isGreenhouseApplyUrl()`
 * could never match a real Adzuna-discovered job — Phase 10's auto-submit
 * path was unreachable in practice.
 *
 * Greenhouse itself publishes a public, unauthenticated, documented API per
 * company (`https://developers.greenhouse.io/job-board.html`) that returns
 * that company's real postings with their real, directly-usable apply URLs.
 * This is a narrower source than Adzuna (per-company, not a broad title/
 * location search) but a completely clean one: no scraping, no click-
 * tracking to defeat, sanctioned by the platform that hosts the data.
 */

const GREENHOUSE_BOARD_TOKEN_PATTERN = /^[a-z0-9][a-z0-9-]{0,80}$/i;

export function isValidGreenhouseBoardToken(token: string): boolean {
  return GREENHOUSE_BOARD_TOKEN_PATTERN.test(token);
}

/**
 * Accepts either a bare board token ("acme") or a full Greenhouse board URL
 * (e.g. "https://boards.greenhouse.io/acme" or ".../acme/jobs/12345") and
 * returns the lowercase board token, or null if neither form is valid.
 */
export function extractGreenhouseBoardToken(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const host = url.hostname.toLowerCase();
      if (host !== "boards.greenhouse.io" && host !== "job-boards.greenhouse.io" && !host.endsWith(".greenhouse.io")) return null;
      const segment = url.pathname.split("/").filter(Boolean)[0];
      return segment && isValidGreenhouseBoardToken(segment) ? segment.toLowerCase() : null;
    } catch {
      return null;
    }
  }

  return isValidGreenhouseBoardToken(trimmed) ? trimmed.toLowerCase() : null;
}

export function greenhouseBoardSourceName(boardToken: string): string {
  return `Greenhouse:${boardToken}`;
}

type GreenhouseBoardMeta = { name: string };

export async function fetchGreenhouseBoardMeta(boardToken: string): Promise<GreenhouseBoardMeta | null> {
  const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}`);
  if (!response.ok) return null;
  const data = (await response.json()) as { name?: string };
  return { name: typeof data.name === "string" && data.name ? data.name : boardToken };
}

type GreenhouseBoardJobRaw = {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  updated_at?: string;
  first_published?: string;
};

export async function searchGreenhouseBoardJobs(boardToken: string): Promise<GreenhouseBoardJobRaw[]> {
  const response = await fetch(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardToken)}/jobs?content=true`);
  if (!response.ok) {
    throw new Error(`Greenhouse board API returned ${response.status} for board "${boardToken}"`);
  }
  const data = (await response.json()) as { jobs?: GreenhouseBoardJobRaw[] };
  return Array.isArray(data.jobs) ? data.jobs : [];
}

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/gi, match => HTML_ENTITIES[match.toLowerCase()] ?? match);
}

/**
 * Greenhouse's `content` field is HTML that's been entity-escaped a second
 * time (e.g. `&lt;div&gt;` rather than a raw `<div>` tag) — decode first,
 * then strip tags, or the tag-stripping regex below would never match.
 */
function stripHtml(html: string): string {
  const decoded = decodeHtmlEntities(html);
  return decoded
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function greenhouseBoardJobToVerifiedListing(job: GreenhouseBoardJobRaw, employer: string, boardToken: string): VerifiedListing | null {
  if (!job.title || !job.absolute_url) return null;
  const description = job.content ? stripHtml(job.content) : "";
  if (description.length < 80) return null;

  const postedAtSource = job.first_published ?? job.updated_at;
  const postedAt = postedAtSource ? new Date(postedAtSource) : new Date();

  return {
    sourceName: greenhouseBoardSourceName(boardToken),
    sourceExternalId: String(job.id),
    sourcePostingUrl: job.absolute_url,
    originalApplyUrl: job.absolute_url,
    title: job.title,
    employer,
    location: job.location?.name || "Location not disclosed",
    employmentType: "full-time",
    description,
    postedAt: Number.isNaN(postedAt.getTime()) ? new Date() : postedAt,
    seniorityMatch: "partial",
    verificationNote: "Retrieved automatically via the target company's own public Greenhouse job-board API (sanctioned by Greenhouse for this exact use, not scraped).",
  };
}
