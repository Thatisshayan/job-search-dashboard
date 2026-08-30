import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  applications,
  candidateProfiles,
  jobs,
  telegramConnections,
  users,
} from "../drizzle/schema";
import { processTelegramApprovalCallback } from "./applicationService";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { createApprovalCallback, hashApprovalNonce } from "./telegram";

// Requires a real MySQL database with the owner's user/profile/Telegram-connection rows
// already seeded (it reads them, it doesn't create them) — not runnable against an
// empty/ephemeral CI database. Opt in locally against a seeded dev DB with
// LIVE_DB_INTEGRATION=1, same convention as the telegram.live.test.ts family.
const liveDbTest = process.env.LIVE_DB_INTEGRATION === "1" ? it : it.skip;

describe("persisted Telegram approval replay protection", () => {
  liveDbTest(
    "consumes the first callback once and leaves a replay as a database no-op",
    async () => {
      const db = await getDb();
      if (!db) throw new Error("Database unavailable");
      const owner = (
        await db
          .select()
          .from(users)
          .where(eq(users.openId, ENV.ownerOpenId))
          .limit(1)
      )[0];
      if (!owner) throw new Error("Dashboard owner is unavailable");
      const profile = (
        await db
          .select()
          .from(candidateProfiles)
          .where(eq(candidateProfiles.userId, owner.id))
          .limit(1)
      )[0];
      const connection = (
        await db
          .select()
          .from(telegramConnections)
          .where(eq(telegramConnections.userId, owner.id))
          .limit(1)
      )[0];
      if (!profile || !connection)
        throw new Error("Candidate profile and Telegram pairing are required");

      const suffix = crypto.randomBytes(8).toString("hex");
      const nonce = crypto.randomBytes(18).toString("base64url");
      let jobId: number | undefined;
      let applicationId: number | undefined;
      try {
        await db.insert(jobs).values({
          sourceName: "Replay protection test",
          sourcePostingUrl: `https://example.test/replay-${suffix}`,
          fingerprint: `approval-replay-${suffix}`,
          title: "Non-actionable replay-protection test",
          employer: "Internal test record",
          location: "Toronto, Ontario",
          description:
            "Internal non-actionable record used only to test single-use Telegram approval handling.",
          status: "unavailable",
        });
        const job = (
          await db
            .select()
            .from(jobs)
            .where(eq(jobs.fingerprint, `approval-replay-${suffix}`))
            .limit(1)
        )[0];
        if (!job) throw new Error("Test job was not created");
        jobId = job.id;
        await db.insert(applications).values({
          userId: owner.id,
          jobId,
          candidateProfileId: profile.id,
          telegramConnectionId: connection.id,
          status: "awaiting_telegram_approval",
          testMode: true,
          reviewPacket: { test: true },
          approvalNonceHash: hashApprovalNonce(nonce),
          approvalExpiresAt: new Date(Date.now() + 60_000),
        });
        const application = (
          await db
            .select()
            .from(applications)
            .where(
              and(
                eq(applications.userId, owner.id),
                eq(applications.jobId, jobId)
              )
            )
            .limit(1)
        )[0];
        if (!application) throw new Error("Test application was not created");
        applicationId = application.id;
        const callback = createApprovalCallback(
          applicationId,
          "approve",
          nonce
        );

        const first = await processTelegramApprovalCallback({
          callbackId: `first-${suffix}`,
          chatId: connection.chatId,
          data: callback,
        });
        const second = await processTelegramApprovalCallback({
          callbackId: `replay-${suffix}`,
          chatId: connection.chatId,
          data: callback,
        });
        const stored = (
          await db
            .select()
            .from(applications)
            .where(eq(applications.id, applicationId))
            .limit(1)
        )[0];

        expect(first.state).toBe("ready_for_final_confirmation");
        expect(second.state).toBe("ignored");
        expect(stored?.status).toBe("ready_for_final_confirmation");
        expect(stored?.approvalNonceHash).toBeNull();
        expect(stored?.decisionCallbackId).toBe(`first-${suffix}`);
      } finally {
        if (applicationId)
          await db
            .delete(applications)
            .where(eq(applications.id, applicationId));
        if (jobId) await db.delete(jobs).where(eq(jobs.id, jobId));
      }
    },
    20_000
  );
});
