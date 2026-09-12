import { ENV } from "../_core/env";

const APIFY_BASE_URL = "https://api.apify.com/v2";
const POLL_INTERVAL_MS = 3_000;
/**
 * Resolves the design spec's open question ("should the poll cap be
 * configurable?") — yes, via an env var, same pattern as
 * ADZUNA_DEFAULT_COUNTRY. Not needed for test speed (apifyClient.test.ts
 * uses vi.useFakeTimers, so the real duration never elapses in CI), but
 * still useful for tuning in production without a code change.
 */
const MAX_POLL_MS = Number(process.env.APIFY_POLL_CAP_MS) || 5 * 60 * 1000;

type ApifyRunStatus = "READY" | "RUNNING" | "SUCCEEDED" | "FAILED" | "TIMED-OUT" | "ABORTED";

const TERMINAL_STATUSES = new Set<ApifyRunStatus>(["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]);

type ApifyRunResponse = {
  data: {
    id: string;
    status: ApifyRunStatus;
    defaultDatasetId: string;
  };
};

export function isApifyConfigured(): boolean {
  return Boolean(ENV.apifyApiToken);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function readJson<T>(response: Response, action: string): Promise<T> {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${action} failed: ${response.status} ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

/**
 * Starts an Apify actor run with the given input, polls until it reaches a
 * terminal status, then fetches the run's dataset items. Apify runs are
 * asynchronous (unlike Adzuna's single-request REST call) — this is a
 * generic run/poll/fetch client, independent of what any specific actor
 * does. The poll cap is a dead-man's-switch against Apify hanging
 * indefinitely, not a "skip this source" policy — see
 * docs/superpowers/specs/2026-09-12-indeed-apify-discovery-design.md.
 */
export async function runApifyActor<T>(actorId: string, input: unknown): Promise<T[]> {
  if (!isApifyConfigured()) {
    throw new Error("APIFY_API_TOKEN is not configured");
  }

  const token = encodeURIComponent(ENV.apifyApiToken);
  const startResponse = await fetch(`${APIFY_BASE_URL}/acts/${encodeURIComponent(actorId)}/runs?token=${token}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  let run = (await readJson<ApifyRunResponse>(startResponse, "Apify actor start")).data;

  const deadline = Date.now() + MAX_POLL_MS;
  while (!TERMINAL_STATUSES.has(run.status)) {
    if (Date.now() > deadline) {
      throw new Error(`Apify actor run ${run.id} did not finish within ${MAX_POLL_MS / 1000}s`);
    }
    await sleep(POLL_INTERVAL_MS);
    const pollResponse = await fetch(`${APIFY_BASE_URL}/actor-runs/${run.id}?token=${token}`);
    run = (await readJson<ApifyRunResponse>(pollResponse, "Apify run poll")).data;
  }

  if (run.status !== "SUCCEEDED") {
    throw new Error(`Apify actor run ${run.id} ended with status ${run.status}`);
  }

  const itemsResponse = await fetch(`${APIFY_BASE_URL}/datasets/${run.defaultDatasetId}/items?token=${token}`);
  return readJson<T[]>(itemsResponse, "Apify dataset fetch");
}
