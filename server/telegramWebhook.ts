import type { Express, Request, Response } from "express";
import { prepareGreenhouseAutoSubmitConfirmation, processGreenhouseConfirmationCallback, processTelegramApprovalCallback } from "./applicationService";
import { isGreenhouseApplyUrl } from "./autoApply/greenhouse";
import { answerTelegramCallback, isGreenhouseConfirmCallback, isValidTelegramWebhookSecret, markApprovalCardResolved, sendFinalBrowserReviewCard } from "./telegram";
import { advanceOnboardingStep, handleIncomingMessage } from "./telegramBot/handler";
import { getConversation } from "./telegramBot/db";
import { sendTailoredMaterialsForJob } from "./telegramBot/tailoring";
import { withChatLock } from "./telegramBot/chatLock";

export function registerTelegramWebhook(app: Express) {
  app.post("/api/telegram/webhook", async (req: Request, res: Response) => {
    if (!isValidTelegramWebhookSecret(req.get("X-Telegram-Bot-Api-Secret-Token"))) {
      res.status(401).json({ ok: false });
      return;
    }

    const chatId = String(req.body?.message?.chat?.id ?? req.body?.callback_query?.message?.chat?.id ?? "");

    const handle = async () => {
      const message = req.body?.message;
      if (message?.chat?.id) {
        try {
          await handleIncomingMessage(message);
        } catch (error) {
          console.error("[TelegramBot] Failed to handle incoming message", error);
        }
        res.status(200).json({ ok: true });
        return;
      }

      const callback = req.body?.callback_query;
      if (!callback?.id || !callback?.data || !callback?.message?.chat?.id) {
        res.status(200).json({ ok: true });
        return;
      }

      const radiusMatch = /^radius:(\d+)$/.exec(String(callback.data));
      if (radiusMatch) {
        const radiusChatId = String(callback.message.chat.id);
        try {
          const conversation = await getConversation(radiusChatId);
          if (conversation?.state === "awaiting_radius") {
            await advanceOnboardingStep(radiusChatId, conversation, radiusMatch[1]);
          }
          await answerTelegramCallback(String(callback.id), `${radiusMatch[1]} km`);
        } catch (error) {
          console.error("[TelegramBot] Failed to handle radius button tap", error);
        }
        res.status(200).json({ ok: true });
        return;
      }

      // Phase 15: generic onboarding-button handler for the track / resume /
      // recurring choice steps. Each button's callback_data carries the step
      // name (matched against the conversation's expected state, so a stale
      // button tap on an old message can't skip the user out of sequence) and
      // the plain-text value to feed into the same planTextStep() logic a
      // typed reply would use.
      const onboardingButtonMatch = /^obstep:(track|resume|recurring):(\w+)$/.exec(String(callback.data));
      if (onboardingButtonMatch) {
        const [, step, value] = onboardingButtonMatch;
        const expectedState: Record<string, string> = {
          track: "awaiting_track_choice",
          resume: "awaiting_resume_choice",
          recurring: "awaiting_recurring_choice",
        };
        const stepChatId = String(callback.message.chat.id);
        try {
          const conversation = await getConversation(stepChatId);
          if (conversation?.state === expectedState[step]) {
            await advanceOnboardingStep(stepChatId, conversation, value);
          }
          await answerTelegramCallback(String(callback.id), value);
        } catch (error) {
          console.error("[TelegramBot] Failed to handle onboarding button tap", error);
        }
        res.status(200).json({ ok: true });
        return;
      }

      const finalChatId = String(callback.message.chat.id);
      const data = String(callback.data);

      // Phase 10 / DECISIONS.md D5: the second, separately-worded
      // CONFIRM/DECLINE tap on a Greenhouse dry-run screenshot. Kept as a
      // distinct callback prefix (v1confirm.) so it can never be confused with
      // or replay the original Approve/Decline callback below.
      if (isGreenhouseConfirmCallback(data)) {
        try {
          const outcome = await processGreenhouseConfirmationCallback({ callbackId: String(callback.id), chatId: finalChatId, data });
          await answerTelegramCallback(String(callback.id), outcome.text);
          res.status(200).json({ ok: true });
        } catch {
          res.status(500).json({ ok: false });
        }
        return;
      }

      try {
        const outcome = await processTelegramApprovalCallback({
          callbackId: String(callback.id),
          chatId: finalChatId,
          data,
        });
        await answerTelegramCallback(String(callback.id), outcome.text);
        if (outcome.state !== "ignored" && outcome.telegramMessageId) {
          await markApprovalCardResolved(finalChatId, outcome.telegramMessageId, outcome.text);
        }
        if (outcome.state === "ready_for_final_confirmation" && outcome.originalApplyUrl) {
          // Phase 10: a Greenhouse-hosted job gets an automated fill +
          // screenshot + a second explicit CONFIRM step instead of just a
          // link — see prepareGreenhouseAutoSubmitConfirmation. Every other
          // job keeps exactly the original D2 manual-link behavior below.
          let autoApplyStarted = false;
          if (isGreenhouseApplyUrl(outcome.originalApplyUrl)) {
            try {
              const autoApplyResult = await prepareGreenhouseAutoSubmitConfirmation(outcome.userId, outcome.jobId);
              autoApplyStarted = autoApplyResult.ok;
              if (!autoApplyResult.ok) {
                console.error(`[TelegramBot] Greenhouse auto-apply setup declined for job ${outcome.jobId}: ${autoApplyResult.reason}`);
              }
            } catch (error) {
              console.error(`[TelegramBot] Greenhouse auto-apply setup failed for job ${outcome.jobId}`, error);
            }
          }

          if (!autoApplyStarted) {
            try {
              await sendFinalBrowserReviewCard({
                chatId: finalChatId,
                title: outcome.jobTitle,
                employer: outcome.employer,
                originalApplyUrl: outcome.originalApplyUrl,
              });
            } catch (error) {
              console.error("Telegram browser-review follow-up could not be delivered", error);
            }
            // Tailored materials are generated only now, on approval — not for
            // every shortlisted job up front (Phase 7: human-in-the-loop before
            // spending LLM calls on jobs the user didn't ask about).
            await sendTailoredMaterialsForJob(finalChatId, outcome.userId, outcome.jobId);
          }
        }
        res.status(200).json({ ok: true });
      } catch {
        res.status(500).json({ ok: false });
      }
    };

    // Serializes handling per chat so a double-delivered webhook (a
    // double-tap, Telegram's own retry) can't race two onboarding-step
    // handlers for the same chat — see docs/superpowers/specs/2026-09-12-
    // multi-tenant-stability-design.md, Fix 3. A malformed payload with
    // neither `message` nor `callback_query` has no chat to key on; it still
    // runs, just unserialized (there's nothing to race in that case).
    if (chatId) {
      await withChatLock(chatId, handle);
    } else {
      await handle();
    }
  });
}
