import { describe, expect, it } from "vitest";

describe("Telegram bot credential", () => {
  it("authenticates with the lightweight getMe endpoint", async () => {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    expect(token, "TELEGRAM_BOT_TOKEN must be configured").toBeTruthy();

    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const body = (await response.json()) as {
      ok?: boolean;
      result?: { is_bot?: boolean };
      description?: string;
    };

    expect(response.ok, `Telegram credential validation failed: ${body.description ?? "unknown error"}`).toBe(true);
    expect(body.ok).toBe(true);
    expect(body.result?.is_bot).toBe(true);
  }, 20_000);
});
