import { sendPlainMessage } from "../telegram";
import { listShortlist } from "../db";
import { getLocalDateKey } from "../utils/date";
import { prepareApplicationForTelegram } from "../applicationService";
import { getConversation, getOrCreateUserForChat, saveCandidateProfile, saveSearchSettingsFromOnboarding, setConversationState, startConversation } from "./db";
import { runJobSearchForUser } from "./jobSearch";
import { planTextStep } from "./onboarding";
import { downloadAndParseResume, isSupportedResumeMime } from "./resumeParsing";

export type TelegramIncomingMessage = {
  chat: { id: number; username?: string };
  text?: string;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
};

const WELCOME_TEXT =
  "Hi! I'll help you search for jobs that match your resume.\n\nFirst, send me your resume as a PDF or Word (.docx) file.";

const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10 MB — generous for a resume, keeps memory use bounded.

export async function handleIncomingMessage(message: TelegramIncomingMessage): Promise<void> {
  const chatId = String(message.chat.id);

  if (message.text?.trim() === "/start") {
    const user = await getOrCreateUserForChat(chatId, message.chat.username ?? "");
    await startConversation(user.id, chatId);
    await sendPlainMessage(chatId, WELCOME_TEXT);
    return;
  }

  const conversation = await getConversation(chatId);
  if (!conversation) {
    await sendPlainMessage(chatId, "Send /start to begin.");
    return;
  }

  if (conversation.state === "awaiting_resume") {
    await handleResumeUpload(chatId, conversation.userId, message);
    return;
  }

  if (!message.text) {
    await sendPlainMessage(chatId, "I need a text reply for this step.");
    return;
  }

  const result = planTextStep(conversation.state, message.text, conversation.context ?? {});
  if (!result.ok) {
    await sendPlainMessage(chatId, result.reply);
    return;
  }

  await setConversationState(chatId, result.nextState, result.context);
  if (result.nextState === "idle") {
    await saveSearchSettingsFromOnboarding(conversation.userId, {
      targetTitles: result.context.targetTitles as string[],
      city: result.context.city as string,
      radiusKm: result.context.radiusKm as number,
    });
    await sendPlainMessage(chatId, result.reply);
    await runInitialSearch(chatId, conversation.userId);
    return;
  }
  await sendPlainMessage(chatId, result.reply);
}

async function runInitialSearch(chatId: string, userId: number): Promise<void> {
  try {
    const outcome = await runJobSearchForUser(userId);
    if (!outcome.ok) {
      const reasonText =
        outcome.reason === "not_configured"
          ? "Job search isn't fully set up on this deployment yet — I've saved your profile and preferences, and I'll search as soon as it is."
          : outcome.reason === "no_results"
            ? "I didn't find any matching roles just now. I'll keep checking."
            : "I couldn't run a search just now — your profile and preferences are saved, though.";
      await sendPlainMessage(chatId, reasonText);
      return;
    }
    if (outcome.shortlisted === 0) {
      await sendPlainMessage(chatId, `Found ${outcome.imported} role${outcome.imported === 1 ? "" : "s"}, but none scored high enough for today's shortlist yet.`);
      return;
    }
    await sendPlainMessage(
      chatId,
      `Found it — ${outcome.imported} matching role${outcome.imported === 1 ? "" : "s"}, ${outcome.shortlisted} made today's shortlist. Review each one below and tap Approve to get a tailored resume + cover letter for it, or Decline to skip.`
    );
    const shortlist = await listShortlist(userId, getLocalDateKey("America/Toronto"));
    for (const item of shortlist) {
      if (!item.job.originalApplyUrl) continue;
      try {
        await prepareApplicationForTelegram(userId, item.job.id);
      } catch (error) {
        console.error(`[TelegramBot] Could not prepare approval card for job ${item.job.id}`, error);
      }
    }
  } catch (error) {
    console.error("[TelegramBot] Initial job search failed", error);
    await sendPlainMessage(chatId, "I ran into an error searching just now — your profile and preferences are saved, and I'll retry later.");
  }
}

async function handleResumeUpload(chatId: string, userId: number, message: TelegramIncomingMessage): Promise<void> {
  const document = message.document;
  if (!document) {
    await sendPlainMessage(chatId, "Please send your resume as a PDF or Word (.docx) file attachment.");
    return;
  }
  if (!isSupportedResumeMime(document.mime_type)) {
    await sendPlainMessage(chatId, "That file type isn't supported yet — please send a PDF or Word (.docx) file.");
    return;
  }
  if (document.file_size && document.file_size > MAX_RESUME_BYTES) {
    await sendPlainMessage(chatId, "That file is too large — please send a resume under 10 MB.");
    return;
  }

  await sendPlainMessage(chatId, "Got it — reading your resume now, one moment…");

  try {
    const profile = await downloadAndParseResume(document.file_id, document.mime_type, document.file_name ?? "Resume");
    await saveCandidateProfile(userId, profile);
    await setConversationState(chatId, "awaiting_target_titles", {});
    await sendPlainMessage(chatId, `Thanks, ${profile.displayName || "there"}! I've read your resume.\n\nWhat roles are you targeting? List one or more, separated by commas.`);
  } catch (error) {
    console.error("[TelegramBot] Resume parsing failed", error);
    const reason = error instanceof Error ? error.message : "something went wrong reading that file";
    await sendPlainMessage(chatId, `I couldn't process that resume (${reason}). Please try sending it again.`);
  }
}
