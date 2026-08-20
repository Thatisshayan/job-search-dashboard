import { describe, expect, it } from "vitest";

describe("Composio credential", () => {
  it("authenticates with the documented tool-catalog endpoint", async () => {
    const apiKey = process.env.COMPOSIO_API_KEY;
    expect(apiKey, "COMPOSIO_API_KEY must be configured for source discovery").toBeTruthy();

    const response = await fetch("https://backend.composio.dev/api/v3.1/tools?limit=1", {
      headers: { "x-api-key": apiKey! },
    });
    const body = await response.text();

    expect(response.ok, `Composio credential validation failed (${response.status}): ${body.slice(0, 250)}`).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  }, 20_000);
});
