import { parsePdfWithRetry } from "./pdfParseWithRetry";

export type AtsParseabilityResult = {
  ok: boolean;
  reasons: string[];
};

const MIN_TEXT_LENGTH = 200;
// A real, readable PDF should have very few control/replacement characters.
// A high ratio is the signature of a garbled-glyph extraction failure (e.g.
// a broken font embedding) even when the raw extracted length looks fine.
const MAX_UNPRINTABLE_RATIO = 0.02;

/**
 * Pure evaluation of already-extracted PDF text against ATS-parseability
 * heuristics: contact info present as real text, no garbled glyphs, enough
 * content to plausibly be a real resume. Kept free of pdf-parse's I/O so
 * it's unit-testable directly — same pure-vs-IO split used throughout this
 * codebase (e.g. greenhouseBoard.ts's filterUnmappedLabels).
 */
export function evaluateExtractedText(text: string, expectedName: string): AtsParseabilityResult {
  const reasons: string[] = [];
  const trimmed = text.trim();

  if (trimmed.length < MIN_TEXT_LENGTH) {
    reasons.push(`Extracted text is too short (${trimmed.length} chars) to be a real resume — likely a rendering failure.`);
  }

  const unprintableCount = (trimmed.match(/[^\x09\x0A\x0D\x20-\x7E]/g) ?? []).length;
  const unprintableRatio = trimmed.length ? unprintableCount / trimmed.length : 1;
  if (unprintableRatio > MAX_UNPRINTABLE_RATIO) {
    reasons.push(`Extracted text is ${(unprintableRatio * 100).toFixed(1)}% non-standard characters — likely garbled glyphs.`);
  }

  if (expectedName.trim() && !trimmed.toLowerCase().includes(expectedName.trim().toLowerCase())) {
    reasons.push("The candidate's name wasn't found as real, extractable text — contact info may not be reading correctly.");
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Phase 11 (ROADMAP.md): runs a freshly generated resume PDF back through
 * the same pdf-parse extraction already used for resume intake
 * (resumeParsing.ts) — catches the failure mode where PDF generation looks
 * right visually but extracts as garbage to a real ATS parser. A detection
 * mechanism, not a blocking gate: callers should log a failure loudly
 * (something real to investigate) rather than withhold the document, since
 * a missing resume is worse for the user than one worth double-checking.
 */
export async function assessPdfAtsParseability(pdfBuffer: Buffer, expectedName: string): Promise<AtsParseabilityResult> {
  const result = await parsePdfWithRetry(pdfBuffer);
  return evaluateExtractedText(result.text, expectedName);
}
