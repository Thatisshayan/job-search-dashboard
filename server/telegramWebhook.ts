import type { Express, Request, Response } from "express";
import { processTelegramApprovalCallback } from "./applicationService";
import { answerTelegramCallback, isValidTelegramWebhookSecret, markApprovalCardResolved } from "./telegram";

export function registerTelegramWebhook(app: Express) {
  app.post("/api/telegram/webhook", async (req: Request, res: Response) => {
    if (!isValidTelegramWebhookSecret(req.get("X-Telegram-Bot-Api-Secret-Token"))) {
      res.status(401).json({ ok: false });
      return;
    }
    const callback = req.body?.callback_query;
    if (!callback?.id || !callback?.data || !callback?.message?.chat?.id) {
      res.status(200).json({ ok: true });
      return;
    }
    try {
      const outcome = await processTelegramApprovalCallback({
        callbackId: String(callback.id),
        chatId: String(callback.message.chat.id),
        data: String(callback.data),
      });
      await answerTelegramCallback(String(callback.id), outcome.text);
      if (outcome.state !== "ignored" && outcome.telegramMessageId) {
        await markApprovalCardResolved(String(callback.message.chat.id), outcome.telegramMessageId, outcome.text);
      }
      res.status(200).json({ ok: true });
    } catch {
      res.status(500).json({ ok: false });
    }
  });
}
