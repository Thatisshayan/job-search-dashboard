export type PdfParseResult = { text: string };

/**
 * `pdf-parse` (a thin, largely unmaintained wrapper around an old bundled
 * pdf.js build) has a real, reproducible cold-start quirk: the very first
 * parse call in a fresh Node process can throw a bogus parsing error
 * (observed: "Command token too long: 128") against a perfectly valid PDF,
 * while an immediate retry on the exact same bytes succeeds every time.
 * Confirmed directly, repeatedly, across fresh processes and different
 * pdfkit-generated buffers: call 1 fails, calls 2+ succeed. This isn't a
 * general "retry on flaky network" policy (see `_core/llm.ts`'s
 * `fetchWithBackoff` for that) — just a one-shot workaround for this
 * specific library quirk, so a single retry is enough.
 *
 * This matters in production, not just for the ATS-parseability check
 * (`atsCheck.ts`) that surfaced it: `resumeParsing.ts`'s résumé intake calls
 * the same library, and the very first PDF résumé a user uploads after a
 * fresh deploy/restart could otherwise hit this and get told their real,
 * valid PDF couldn't be read.
 */
export async function parsePdfWithRetry(buffer: Buffer): Promise<PdfParseResult> {
  const pdfParse = (await import("pdf-parse")).default;
  try {
    return await pdfParse(buffer);
  } catch (firstError) {
    try {
      return await pdfParse(buffer);
    } catch {
      throw firstError;
    }
  }
}
