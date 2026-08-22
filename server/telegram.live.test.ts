import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { getDb } from "./db";
import { bindTelegramConnection, createResumeBackedTestJob, prepareApplicationForTelegram } from "./applicationService";
import { setTelegramWebhook } from "./telegram";
import { ENV } from "./_core/env";

const liveTest = process.env.LIVE_TELEGRAM_E2E === "1" ? it : it.skip;

describe("live Telegram application approval setup", () => {
  liveTest("prepares a resume-backed test application and delivers an approval card", async () => {
    const chatId = process.env.TELEGRAM_TEST_CHAT_ID;
    const webhookUrl = process.env.TELEGRAM_TEST_WEBHOOK_URL;
    expect(chatId, "TELEGRAM_TEST_CHAT_ID is required for the live test").toBeTruthy();
    expect(webhookUrl, "TELEGRAM_TEST_WEBHOOK_URL is required for the live test").toBeTruthy();

    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const owner = (await db.select().from(users).where(eq(users.openId, ENV.ownerOpenId)).limit(1))[0];
    if (!owner) throw new Error("Dashboard owner is not available");

    await bindTelegramConnection(owner.id, chatId!, "Jobapplicationworkflowbot");
    await setTelegramWebhook(webhookUrl!);
    const testJob = await createResumeBackedTestJob(owner.id, true);
    const application = await prepareApplicationForTelegram(owner.id, testJob.id, true);

    expect(application?.status).toBe("awaiting_telegram_approval");
    expect(application?.testMode).toBe(true);
    expect(application?.telegramMessageId).toBeTypeOf("number");
  }, 30_000);
});
