/**
 * Holds the exact materials shown in a Greenhouse dry-run screenshot until
 * the user taps CONFIRM, so the real submit uses precisely what was
 * reviewed instead of a fresh, independently-generated (and non-
 * deterministic — it's an LLM call) resume/cover letter. Without this, the
 * dry-run and the real submission could silently diverge, defeating the
 * entire point of showing a screenshot before the irreversible step.
 *
 * In-memory, single instance, TTL-bounded (matches the approval card's own
 * 30-minute expiry) — consistent with this project's other single-instance
 * assumptions (see scheduler.ts). If the process restarts between dry-run
 * and CONFIRM, the entry is gone and the caller must fail safe (fall back
 * to the manual-link flow) rather than silently regenerate different
 * content — see processGreenhouseConfirmationCallback in applicationService.ts.
 */

export type PendingGreenhouseSubmission = {
  resumePdf: Buffer;
  coverLetterText: string;
  candidate: { fullName: string; email: string; phone?: string };
};

const TTL_MS = 30 * 60_000;

const store = new Map<number, PendingGreenhouseSubmission & { createdAt: number }>();

export function savePendingGreenhouseSubmission(applicationId: number, data: PendingGreenhouseSubmission): void {
  store.set(applicationId, { ...data, createdAt: Date.now() });
}

/** Single-use: removes the entry whether or not it's returned. */
export function takePendingGreenhouseSubmission(applicationId: number): PendingGreenhouseSubmission | null {
  const entry = store.get(applicationId);
  store.delete(applicationId);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > TTL_MS) return null;
  const { resumePdf, coverLetterText, candidate } = entry;
  return { resumePdf, coverLetterText, candidate };
}

export function discardPendingGreenhouseSubmission(applicationId: number): void {
  store.delete(applicationId);
}
