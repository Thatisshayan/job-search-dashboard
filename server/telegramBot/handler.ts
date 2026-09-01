import { BOT_COMMANDS, sendButtonMessage, sendPlainMessage } from "../telegram";
import { getConversation, getOrCreateUserForChat, saveCandidateProfile, saveSearchSettingsFromOnboarding, setConversationState, startConversation } from "./db";
import { runSearchAndNotify } from "./notify";
import { planTextStep } from "./onboarding";
import { downloadAndParseResume, isSupportedResumeMime, parseResumeText } from "./resumeParsing";
import { handleUnwatchCommand, handleWatchCommand, handleWatchingCommand } from "./watch";

type BotConversation = NonNullable<Awaited<ReturnType<typeof getConversation>>>;

const RADIUS_CHOICES_KM = [25, 50, 75, 100];

export type TelegramIncomingMessage = {
  chat: { id: number; username?: string };
  text?: string;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
};

const WELCOME_TEXT =
  "Hi! I'll help you search for jobs that match your resume.\n\nSend it as a PDF or Word (.docx) file, or just paste the text of your resume directly in the chat.";

const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10 MB — generous for a resume, keeps memory use bounded.
const MIN_PASTED_RESUME_CHARS = 200; // below this, treat it as a stray reply, not a resume paste.

/**
 * Generated from telegram.ts's BOT_COMMANDS (the same list registered with
 * Telegram's "/" autocomplete menu via setBotCommands at boot) so the two
 * can never list different commands.
 */
export const HELP_TEXT = `Here's everything I can do:\n\n${BOT_COMMANDS.map(({ command, description }) => `/${command} — ${description}`).join("\n")}\n\nDuring onboarding, just reply with text (or tap a button when I offer one) — no special command needed for that part. Approve/Decline/Confirm on job cards are buttons on the message itself, not commands.`;

function stripBotMention(command: string): string {
  return command.replace(/@\S+$/, "");
}

export async function handleIncomingMessage(message: TelegramIncomingMessage): Promise<void> {
  const chatId = String(message.chat.id);
  const firstWord = message.text?.trim().split(/\s+/)[0];
  const command = firstWord?.startsWith("/") ? stripBotMention(firstWord) : null;

  if (command === "/start") {
    const user = await getOrCreateUserForChat(chatId, message.chat.username ?? "");
    await startConversation(user.id, chatId);
    await sendPlainMessage(chatId, WELCOME_TEXT);
    return;
  }

  if (command === "/help") {
    await sendPlainMessage(chatId, HELP_TEXT);
    return;
  }

  const watchCommand = message.text ? /^\/(watch|unwatch|watching)(?:@\S+)?(?:\s+(.*))?$/.exec(message.text.trim()) : null;
  if (watchCommand) {
    const user = await getOrCreateUserForChat(chatId, message.chat.username ?? "");
    const [, command, argument] = watchCommand;
    if (command === "watch") await handleWatchCommand(chatId, user.id, argument ?? "");
    else if (command === "unwatch") await handleUnwatchCommand(chatId, user.id, argument ?? "");
    else await handleWatchingCommand(chatId, user.id);
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

  await advanceOnboardingStep(chatId, conversation, message.text);
}

/**
 * Advances a plain-text (or button-tap-supplied) onboarding step. Shared by
 * `handleIncomingMessage` (typed replies) and `handleOnboardingButtonTap`
 * (../telegramWebhook.ts, radius quick-pick buttons) so both input methods
 * go through the exact same state transitions.
 */
export async function advanceOnboardingStep(chatId: string, conversation: BotConversation, text: string): Promise<void> {
  const result = planTextStep(conversation.state, text, conversation.context ?? {});
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
    await runSearchAndNotify(chatId, conversation.userId);
    return;
  }

  if (result.nextState === "awaiting_radius") {
    await sendButtonMessage(
      chatId,
      result.reply,
      [RADIUS_CHOICES_KM.map(km => ({ text: `${km} km`, callback_data: `radius:${km}` }))]
    );
    return;
  }

  await sendPlainMessage(chatId, result.reply);
}

async function handleResumeUpload(chatId: string, userId: number, message: TelegramIncomingMessage): Promise<void> {
  const document = message.document;
  if (document) {
    await handleResumeDocument(chatId, userId, document);
    return;
  }

  const pastedText = message.text?.trim();
  if (pastedText && pastedText.length >= MIN_PASTED_RESUME_CHARS) {
    await handleResumePastedText(chatId, userId, pastedText);
    return;
  }

  await sendPlainMessage(chatId, "Please send your resume as a PDF or Word (.docx) file, or paste the full text of your resume in a message.");
}

async function handleResumeDocument(chatId: string, userId: number, document: NonNullable<TelegramIncomingMessage["document"]>): Promise<void> {
  if (!isSupportedResumeMime(document.mime_type)) {
    await sendPlainMessage(chatId, "That file type isn't supported yet — please send a PDF or Word (.docx) file, or paste the resume text instead.");
    return;
  }
  if (document.file_size && document.file_size > MAX_RESUME_BYTES) {
    await sendPlainMessage(chatId, "That file is too large — please send a resume under 10 MB.");
    return;
  }

  await sendPlainMessage(chatId, "Got it — reading your resume now, one moment…");

  try {
    const profile = await downloadAndParseResume(document.file_id, document.mime_type, document.file_name ?? "Resume");
    await finishResumeIntake(chatId, userId, profile);
  } catch (error) {
    console.error("[TelegramBot] Resume parsing failed", error);
    const reason = error instanceof Error ? error.message : "something went wrong reading that file";
    await sendPlainMessage(chatId, `I couldn't process that resume (${reason}). Please try sending it again.`);
  }
}

async function handleResumePastedText(chatId: string, userId: number, resumeText: string): Promise<void> {
  await sendPlainMessage(chatId, "Got it — reading your resume now, one moment…");

  try {
    const parsed = await parseResumeText(resumeText);
    await finishResumeIntake(chatId, userId, { ...parsed, resumeLabel: "Pasted resume text" });
  } catch (error) {
    console.error("[TelegramBot] Pasted resume parsing failed", error);
    const reason = error instanceof Error ? error.message : "something went wrong reading that text";
    await sendPlainMessage(chatId, `I couldn't process that (${reason}). Please try pasting it again, or send it as a PDF/Word file instead.`);
  }
}

async function finishResumeIntake(chatId: string, userId: number, profile: Parameters<typeof saveCandidateProfile>[1]): Promise<void> {
  await saveCandidateProfile(userId, profile);
  await setConversationState(chatId, "awaiting_target_titles", {});
  await sendPlainMessage(chatId, `Thanks, ${profile.displayName || "there"}! I've read your resume.\n\nWhat roles are you targeting? List one or more, separated by commas.`);
}
