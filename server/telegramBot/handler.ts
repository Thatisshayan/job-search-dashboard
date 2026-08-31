import { sendPlainMessage } from "../telegram";
import { getConversation, getOrCreateUserForChat, saveCandidateProfile, saveSearchSettingsFromOnboarding, setConversationState, startConversation } from "./db";
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
  }
  await sendPlainMessage(chatId, result.reply);
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
