/**
 * Phase 14a: builds a candidate profile from a public LinkedIn/Indeed
 * profile page instead of an uploaded résumé. See docs/telegram-agent/
 * ROADMAP.md's Phase 14a for the full scope and the explicit risk this
 * was built under: fetching runs unauthenticated (no login, no session/
 * cookie persistence) via Camoufox specifically to get past LinkedIn's
 * bot-detection on a page it does not want scraped — a deliberate,
 * user-approved exception to this project's usual stance (see
 * DECISIONS.md's Adzuna update note, where the equivalent request was
 * declined). Keep this narrow: one on-demand fetch per user request,
 * never a crawler, never scheduled, nothing cached or redistributed.
 *
 * The fetched page's visible text is handed to the *same*
 * resumeParsing.ts `parseResumeText` pipeline already used for pasted
 * résumé text — this module is only a new text source, not a new
 * profile format.
 */

export function isSupportedProfileUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = parsed.hostname.toLowerCase();
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    return parsed.pathname.toLowerCase().startsWith("/in/");
  }
  if (host === "indeed.com" || host.endsWith(".indeed.com")) {
    return /\/(r|resume|profile)\//i.test(parsed.pathname);
  }
  return false;
}

const MIN_EXTRACTED_TEXT_CHARS = 200;

/**
 * Fetches a public profile page and returns its visible text. Returns
 * null (never throws) on any failure — a fetch failure must fall back to
 * asking for a pasted/uploaded résumé instead of breaking onboarding.
 */
export async function fetchPublicProfileText(profileUrl: string): Promise<string | null> {
  if (!isSupportedProfileUrl(profileUrl)) return null;

  const { Camoufox } = await import("camoufox-js");
  const browser = await Camoufox({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(profileUrl, { waitUntil: "networkidle", timeout: 30_000 });
    const text = await page.locator("body").innerText();
    const trimmed = text.trim();
    if (trimmed.length < MIN_EXTRACTED_TEXT_CHARS) return null;
    return trimmed;
  } catch (error) {
    console.error(`[profileImport] Failed to fetch public profile ${profileUrl}`, error);
    return null;
  } finally {
    await browser.close();
  }
}
