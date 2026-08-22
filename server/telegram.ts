import crypto from "node:crypto";
import { ENV } from "./_core/env";

type TelegramEnvelope<T> = { ok: boolean; result?: T; description?: string };

type ApprovalDecision = "approve" | "decline";

export type ApprovalCallback = {
  applicationId: number;
  decision: ApprovalDecision;
  nonce: string;
};

function getBotToken() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  return token;
}

function getSigningKey() {
  if (!ENV.cookieSecret) throw new Error("Server signing material is unavailable");
  return ENV.cookieSecret;
}

export function getTelegramWebhookSecret() {
  return crypto.createHmac("sha256", getSigningKey()).update("telegram-webhook-v1").digest("base64url");
}

export function isValidTelegramWebhookSecret(value: string | undefined) {
  if (!value) return false;
  const expected = getTelegramWebhookSecret();
  if (value.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(value), Buffer.from(expected));
}

export function hashApprovalNonce(nonce: string) {
  return crypto.createHash("sha256").update(nonce).digest("hex");
}

export function resolveSingleUseApproval(input: {
  currentStatus: string;
  storedNonceHash: string | null;
  expiresAt: Date | null;
  nonce: string;
  decision: ApprovalDecision;
}) {
  if (input.currentStatus !== "awaiting_telegram_approval") return null;
  if (!input.expiresAt || input.expiresAt.getTime() < Date.now()) return null;
  if (!input.storedNonceHash || input.storedNonceHash !== hashApprovalNonce(input.nonce)) return null;
  return input.decision === "approve" ? "ready_for_final_confirmation" : "declined";
}

export function createApprovalCallback(applicationId: number, decision: ApprovalDecision, nonce: string) {
  const payload = `${applicationId}.${decision}.${nonce}`;
  const signature = crypto.createHmac("sha256", getSigningKey()).update(`telegram-approval-v1:${payload}`).digest("base64url").slice(0, 18);
  return `v1.${payload}.${signature}`;
}

export function verifyApprovalCallback(value: string): ApprovalCallback | null {
  const [version, rawId, decision, nonce, signature] = value.split(".");
  if (version !== "v1" || !rawId || (decision !== "approve" && decision !== "decline") || !nonce || !signature) return null;
  const applicationId = Number(rawId);
  if (!Number.isSafeInteger(applicationId) || applicationId < 1) return null;
  const payload = `${applicationId}.${decision}.${nonce}`;
  const expected = crypto.createHmac("sha256", getSigningKey()).update(`telegram-approval-v1:${payload}`).digest("base64url").slice(0, 18);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return { applicationId, decision, nonce };
}

async function telegramApi<T>(method: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${getBotToken()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as TelegramEnvelope<T>;
  if (!response.ok || !body.ok || body.result === undefined) throw new Error(`Telegram ${method} failed: ${body.description ?? "unknown error"}`);
  return body.result;
}

export async function setTelegramWebhook(url: string) {
  return telegramApi<boolean>("setWebhook", {
    url,
    secret_token: getTelegramWebhookSecret(),
    allowed_updates: ["callback_query"],
    drop_pending_updates: false,
  });
}

export async function sendApprovalCard(input: {
  chatId: string;
  applicationId: number;
  title: string;
  employer: string;
  location: string;
  score: number | null;
  rationale: string;
  testMode: boolean;
  approveCallback: string;
  declineCallback: string;
}) {
  const prefix = input.testMode ? "TEST MODE — no employer application exists\n\n" : "Application review\n\n";
  const scoreLine = input.score === null ? "Fit score: unavailable" : `Fit score: ${input.score}/100`;
  const text = `${prefix}${input.title}\n${input.employer}\n${input.location}\n${scoreLine}\n\nWhy selected: ${input.rationale}\n\nApprove moves this one reviewed application to browser-ready status. It never submits an employer form.`;
  return telegramApi<{ message_id: number }>("sendMessage", {
    chat_id: input.chatId,
    text,
    reply_markup: {
      inline_keyboard: [[
        { text: input.testMode ? "Approve test review" : "Approve for final review", callback_data: input.approveCallback },
        { text: "Decline", callback_data: input.declineCallback },
      ]],
    },
  });
}

export function finalBrowserReviewText(input: { title: string; employer: string }) {
  return `Telegram approval recorded for ${input.title} at ${input.employer}. Open the original application, review only verified résumé-backed details, and provide final confirmation on that specific employer form before it is submitted.`;
}

export async function sendFinalBrowserReviewCard(input: { chatId: string; title: string; employer: string; originalApplyUrl: string }) {
  return telegramApi<{ message_id: number }>("sendMessage", {
    chat_id: input.chatId,
    text: finalBrowserReviewText(input),
    reply_markup: {
      inline_keyboard: [[{ text: "Open original application", url: input.originalApplyUrl }]],
    },
  });
}

export function originalLinkReviewText(input: { rank: number; score: number; title: string; employer: string; location: string; sourceName: string }) {
  return `Verified shortlist match #${input.rank} — ${input.score}/100\n\n${input.title}\n${input.employer}\n${input.location}\nSource: ${input.sourceName}\n\nOpen the original application to review the role. Opening this link does not submit an employer application; final confirmation is still required before any submission.`;
}

export async function sendOriginalLinkReviewCard(input: {
  chatId: string;
  rank: number;
  score: number;
  title: string;
  employer: string;
  location: string;
  sourceName: string;
  originalApplyUrl: string;
}) {
  return telegramApi<{ message_id: number }>("sendMessage", {
    chat_id: input.chatId,
    text: originalLinkReviewText(input),
    reply_markup: {
      inline_keyboard: [[{ text: "Open original application", url: input.originalApplyUrl }]],
    },
  });
}

export async function answerTelegramCallback(callbackQueryId: string, text: string) {
  return telegramApi<boolean>("answerCallbackQuery", { callback_query_id: callbackQueryId, text, show_alert: false });
}

export async function markApprovalCardResolved(chatId: string, messageId: number, text: string) {
  return telegramApi<boolean>("editMessageReplyMarkup", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } }).then(async () =>
    telegramApi<boolean>("editMessageText", { chat_id: chatId, message_id: messageId, text }),
  );
}
