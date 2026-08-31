import type { Page } from "playwright-core";

/**
 * Automates filling (and, only when explicitly told to, submitting) a real
 * Greenhouse job-board apply form. See docs/telegram-agent/DECISIONS.md D5
 * for the full reasoning and safety model: this always runs in dry-run mode
 * first (fill + screenshot, no submit) so a human can review the filled
 * form before the one truly irreversible action happens.
 *
 * Runs on Camoufox (camoufox-js), not plain Chromium — chosen for its
 * better-documented track record running in minimal Linux containers like
 * Railway's. This is strictly a browser-engine choice: isGreenhouseApplyUrl()
 * below is a hard allowlist and stays that way — see DECISIONS.md D5's
 * "Explicitly declined" note on why this is not a general-purpose bypass
 * for other job boards' bot-detection.
 *
 * Field selectors here are heuristic, covering both Greenhouse's classic
 * embed (boards.greenhouse.io) and its newer job-boards UI
 * (job-boards.greenhouse.io) as best-known at the time this was written —
 * NOT verified against a live posting yet. Expect to need adjustment once
 * this runs against a real board (see ROADMAP.md Phase 10).
 */

export function isGreenhouseApplyUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io" || host.endsWith(".greenhouse.io");
  } catch {
    return false;
  }
}

const FIELD_SELECTORS = {
  firstName: ['#first_name', 'input[name="job_application[first_name]"]', 'input[autocomplete="given-name"]'],
  lastName: ['#last_name', 'input[name="job_application[last_name]"]', 'input[autocomplete="family-name"]'],
  email: ['#email', 'input[name="job_application[email]"]', 'input[type="email"]'],
  phone: ['#phone', 'input[name="job_application[phone]"]', 'input[type="tel"]'],
  resume: ['#resume', 'input[type="file"][name*="resume" i]'],
  coverLetterText: ['#cover_letter_text', 'textarea[name*="cover_letter" i]'],
} as const;

const KNOWN_FIELD_LABEL_HINTS = ["first name", "last name", "email", "phone", "resume", "cover letter"];

async function fillFirstMatch(page: Page, selectors: readonly string[], value: string): Promise<boolean> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await locator.fill(value);
      return true;
    }
  }
  return false;
}

async function uploadResume(page: Page, resumePdf: Buffer): Promise<boolean> {
  for (const selector of FIELD_SELECTORS.resume) {
    const locator = page.locator(selector).first();
    if ((await locator.count()) > 0) {
      await locator.setInputFiles({ name: "resume.pdf", mimeType: "application/pdf", buffer: resumePdf });
      return true;
    }
  }
  return false;
}

/** Best-effort list of question labels on the page this code doesn't know how to answer. */
async function detectUnmappedQuestions(page: Page): Promise<string[]> {
  const labels = await page.locator("label").allTextContents();
  return labels
    .map(label => label.trim())
    .filter(Boolean)
    .filter(label => !KNOWN_FIELD_LABEL_HINTS.some(hint => label.toLowerCase().includes(hint)))
    .slice(0, 10);
}

async function detectCaptcha(page: Page): Promise<boolean> {
  const count = await page.locator('iframe[src*="captcha" i], iframe[title*="challenge" i], [class*="turnstile" i]').count();
  return count > 0;
}

export type GreenhouseRunInput = {
  applyUrl: string;
  candidate: { fullName: string; email: string; phone?: string };
  resumePdf: Buffer;
  coverLetterText?: string;
  submit: boolean;
};

export type GreenhouseRunResult = {
  screenshot: Buffer;
  unmappedQuestions: string[];
  captchaDetected: boolean;
  resumeUploaded: boolean;
  submitted: boolean;
};

export async function runGreenhouseApplication(input: GreenhouseRunInput): Promise<GreenhouseRunResult> {
  const { Camoufox } = await import("camoufox-js");
  const browser = await Camoufox({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(input.applyUrl, { waitUntil: "networkidle", timeout: 30_000 });

    const captchaDetected = await detectCaptcha(page);

    const [firstName, ...rest] = input.candidate.fullName.trim().split(/\s+/);
    const lastName = rest.join(" ") || firstName || "";

    await fillFirstMatch(page, FIELD_SELECTORS.firstName, firstName ?? "");
    await fillFirstMatch(page, FIELD_SELECTORS.lastName, lastName);
    await fillFirstMatch(page, FIELD_SELECTORS.email, input.candidate.email);
    if (input.candidate.phone) await fillFirstMatch(page, FIELD_SELECTORS.phone, input.candidate.phone);
    if (input.coverLetterText) await fillFirstMatch(page, FIELD_SELECTORS.coverLetterText, input.coverLetterText);
    const resumeUploaded = await uploadResume(page, input.resumePdf);

    const unmappedQuestions = await detectUnmappedQuestions(page);

    let submitted = false;
    if (input.submit) {
      if (captchaDetected) {
        throw new Error("CAPTCHA/bot-detection present on this apply page — cannot submit automatically. Falling back to the manual apply link.");
      }
      const submitButton = page.locator('button[type="submit"], input[type="submit"]').first();
      if ((await submitButton.count()) === 0) {
        throw new Error("Could not find a submit button on this apply page.");
      }
      await submitButton.click();
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
      submitted = true;
    }

    const screenshot = await page.screenshot({ fullPage: true });
    return { screenshot, unmappedQuestions, captchaDetected, resumeUploaded, submitted };
  } finally {
    await browser.close();
  }
}
