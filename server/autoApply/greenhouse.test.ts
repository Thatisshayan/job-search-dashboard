import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { CAPTCHA_SELECTOR, FIELD_SELECTORS, filterUnmappedLabels, isGreenhouseApplyUrl } from "./greenhouse";

describe("isGreenhouseApplyUrl", () => {
  it("matches known Greenhouse job-board hostnames", () => {
    expect(isGreenhouseApplyUrl("https://boards.greenhouse.io/acme/jobs/12345")).toBe(true);
    expect(isGreenhouseApplyUrl("https://job-boards.greenhouse.io/acme/jobs/12345")).toBe(true);
    expect(isGreenhouseApplyUrl("https://acme.greenhouse.io/jobs/12345")).toBe(true);
  });

  it("rejects non-Greenhouse URLs and malformed input", () => {
    expect(isGreenhouseApplyUrl("https://boards.lever.co/acme/12345")).toBe(false);
    expect(isGreenhouseApplyUrl("https://example.com/apply")).toBe(false);
    expect(isGreenhouseApplyUrl(null)).toBe(false);
    expect(isGreenhouseApplyUrl(undefined)).toBe(false);
    expect(isGreenhouseApplyUrl("not a url")).toBe(false);
  });
});

/**
 * Confirms FIELD_SELECTORS / CAPTCHA_SELECTOR actually resolve against
 * realistic Greenhouse markup, entirely offline (jsdom parsing a fixture
 * string, no browser launch, no network call) — the "field-mapping logic
 * tested against fixture HTML" item from ROADMAP.md's Phase 10 checklist.
 * These fixtures are hand-written approximations of Greenhouse's classic
 * embed and newer job-boards UI, not captured from a live page, so treat a
 * pass here as "the selector list is internally consistent," not "proven
 * against production markup" — that still needs a real /watch live test.
 */
function firstMatch(document: Document, selectors: readonly string[]): Element | null {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) return el;
  }
  return null;
}

const CLASSIC_EMBED_HTML = `
  <form id="application_form">
    <label for="first_name">First Name</label>
    <input id="first_name" name="job_application[first_name]" type="text" />
    <label for="last_name">Last Name</label>
    <input id="last_name" name="job_application[last_name]" type="text" />
    <label for="email">Email</label>
    <input id="email" name="job_application[email]" type="email" />
    <label for="phone">Phone</label>
    <input id="phone" name="job_application[phone]" type="tel" />
    <label for="resume">Resume/CV</label>
    <input id="resume" name="job_application[resume]" type="file" />
    <label for="cover_letter_text">Cover Letter</label>
    <textarea id="cover_letter_text" name="job_application[cover_letter_text]"></textarea>
    <label>How did you hear about this role?</label>
    <input type="text" name="custom_question_1" />
    <button type="submit">Submit Application</button>
  </form>
`;

const JOB_BOARDS_UI_HTML = `
  <form>
    <input name="job_application[first_name]" type="text" autocomplete="given-name" />
    <input name="job_application[last_name]" type="text" autocomplete="family-name" />
    <input name="job_application[email]" type="email" />
    <input name="job_application[phone]" type="tel" />
    <input type="file" name="job_application_resume" />
    <textarea name="job_application_cover_letter_text"></textarea>
    <input type="submit" value="Submit application" />
  </form>
`;

describe("FIELD_SELECTORS against fixture Greenhouse HTML", () => {
  it.each([
    ["classic boards.greenhouse.io embed", CLASSIC_EMBED_HTML],
    ["newer job-boards.greenhouse.io UI", JOB_BOARDS_UI_HTML],
  ])("resolves every core field on the %s", (_label, html) => {
    const { window } = new JSDOM(html);
    expect(firstMatch(window.document, FIELD_SELECTORS.firstName)).not.toBeNull();
    expect(firstMatch(window.document, FIELD_SELECTORS.lastName)).not.toBeNull();
    expect(firstMatch(window.document, FIELD_SELECTORS.email)).not.toBeNull();
    expect(firstMatch(window.document, FIELD_SELECTORS.phone)).not.toBeNull();
    expect(firstMatch(window.document, FIELD_SELECTORS.resume)).not.toBeNull();
    expect(firstMatch(window.document, FIELD_SELECTORS.coverLetterText)).not.toBeNull();
  });

  it("does not false-match fields on a page with no application form", () => {
    const { window } = new JSDOM("<html><body><p>This job posting has closed.</p></body></html>");
    expect(firstMatch(window.document, FIELD_SELECTORS.firstName)).toBeNull();
    expect(firstMatch(window.document, FIELD_SELECTORS.resume)).toBeNull();
  });
});

describe("captcha detection against fixture HTML", () => {
  it("detects a Cloudflare Turnstile widget", () => {
    const { window } = new JSDOM('<div class="cf-turnstile" data-sitekey="x"></div>');
    expect(window.document.querySelector(CAPTCHA_SELECTOR)).not.toBeNull();
  });

  it("detects a captcha iframe by src", () => {
    const { window } = new JSDOM('<iframe src="https://example.com/captcha/challenge"></iframe>');
    expect(window.document.querySelector(CAPTCHA_SELECTOR)).not.toBeNull();
  });

  it("finds nothing on a clean form", () => {
    const { window } = new JSDOM(CLASSIC_EMBED_HTML);
    expect(window.document.querySelector(CAPTCHA_SELECTOR)).toBeNull();
  });
});

describe("filterUnmappedLabels", () => {
  it("excludes labels matching known mapped fields, case-insensitively", () => {
    const result = filterUnmappedLabels(["First Name", "  Email  ", "Cover Letter", "How did you hear about this role?"]);
    expect(result).toEqual(["How did you hear about this role?"]);
  });

  it("drops blank labels and caps the list at 10", () => {
    const labels = ["", "  ", ...Array.from({ length: 15 }, (_, i) => `Custom question ${i}`)];
    const result = filterUnmappedLabels(labels);
    expect(result).toHaveLength(10);
    expect(result[0]).toBe("Custom question 0");
  });
});
