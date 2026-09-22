import { BOT_COMMANDS, sendButtonMessage, sendPlainMessage } from "../telegram";
import { getConversation, getOrCreateUserForChat, getSearchSettingsForUser, saveCandidateProfile, saveSearchSettingsFromOnboarding, setConversationState, startConversation } from "./db";
import { runSearchAndNotify } from "./notify";
import { planTextStep } from "./onboarding";
import { downloadAndParseResume, isSupportedResumeMime, parseResumeText } from "./resumeParsing";
import { handleUnwatchCommand, handleWatchCommand, handleWatchingCommand } from "./watch";
import { handleGeneralWorkCommand, runGeneralWorkAndNotify } from "./generalWork";
import { fetchPublicProfileText, isSupportedProfileUrl } from "../profileImport/publicProfile";
import { suggestTargetTitles } from "./titleSuggestions";
import { handleCountryCommand } from "./country";
import { handleStatusCommand } from "./status";

type BotConversation = NonNullable<Awaited<ReturnType<typeof getConversation>>>;

const RADIUS_CHOICES_KM = [25, 50, 75, 100];

export type TelegramIncomingMessage = {
  chat: { id: number; username?: string };
  text?: string;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
};

const WELCOME_TEXT =
  "Hi! I'll help you search for jobs.\n\nAre you looking for immediate/general work, or career-focused work?";

const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10 MB — generous for a resume, keeps memory use bounded.
const MIN_PASTED_RESUME_CHARS = 200; // below this, treat it as a stray reply, not a resume paste.
const MIN_BUILD_INTAKE_CHARS = 20; // resume-build Q&A intake is guided, so needs far less than a full pasted resume.

/**
 * Generated from telegram.ts's BOT_COMMANDS (the same list registered with
 * Telegram's "/" autocomplete menu via setBotCommands at boot) so the two
 * can never list different commands.
 */
export const HELP_TEXT = `Here's everything I can do:\n\n${BOT_COMMANDS.map(({ command, description, usage }) => `/${command} — ${description}${usage ? `\n${usage}` : ""}`).join("\n\n")}\n\nDuring onboarding, just reply with text (or tap a button when I offer one) — no special command needed for that part. Approve/Decline/Confirm on job cards are buttons on the message itself, not commands.`;

function stripBotMention(command: string): string {
  return command.replace(/@\S+$/, "");
}

async function sendTrackChoiceButtons(chatId: string, text: string): Promise<void> {
  await sendButtonMessage(chatId, text, [
    [
      { text: "Immediate/general work", callback_data: "obstep:track:general" },
      { text: "Career work", callback_data: "obstep:track:career" },
    ],
  ]);
}

async function sendResumeChoiceButtons(chatId: string, text: string): Promise<void> {
  await sendButtonMessage(chatId, text, [
    [
      { text: "I have one ready", callback_data: "obstep:resume:ready" },
      { text: "Build one for me", callback_data: "obstep:resume:build" },
    ],
  ]);
}

export async function handleIncomingMessage(message: TelegramIncomingMessage): Promise<void> {
  const chatId = String(message.chat.id);
  const firstWord = message.text?.trim().split(/\s+/)[0];
  const command = firstWord?.startsWith("/") ? stripBotMention(firstWord) : null;

  if (command === "/start") {
    const user = await getOrCreateUserForChat(chatId, message.chat.username ?? "");
    await startConversation(user.id, chatId);
    await sendTrackChoiceButtons(chatId, WELCOME_TEXT);
    return;
  }

  if (command === "/help") {
    await sendPlainMessage(chatId, HELP_TEXT);
    return;
  }

  if (command === "/status") {
    const user = await getOrCreateUserForChat(chatId, message.chat.username ?? "");
    await handleStatusCommand(chatId, user.id);
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

  const generalWorkCommand = message.text ? /^\/generalwork(?:@\S+)?(?:\s+(.*))?$/.exec(message.text.trim()) : null;
  if (generalWorkCommand) {
    const user = await getOrCreateUserForChat(chatId, message.chat.username ?? "");
    await handleGeneralWorkCommand(chatId, user.id, generalWorkCommand[1] ?? "");
    return;
  }

  const editCommand = message.text ? /^\/edit(?:@\S+)?(?:\s+(.*))?$/.exec(message.text.trim()) : null;
  if (editCommand) {
    const user = await getOrCreateUserForChat(chatId, message.chat.username ?? "");
    await handleEditCommand(chatId, user.id, (editCommand[1] ?? "").trim().toLowerCase());
    return;
  }

  const countryCommand = message.text ? /^\/country(?:@\S+)?(?:\s+(.*))?$/.exec(message.text.trim()) : null;
  if (countryCommand) {
    const user = await getOrCreateUserForChat(chatId, message.chat.username ?? "");
    await handleCountryCommand(chatId, user.id, countryCommand[1] ?? "");
    return;
  }

  const conversation = await getConversation(chatId);
  if (!conversation) {
    await sendPlainMessage(chatId, "Send /start to begin.");
    return;
  }

  if (conversation.state === "awaiting_resume") {
    await handleResumeUpload(chatId, conversation.userId, message, conversation.context ?? {});
    return;
  }

  if (conversation.state === "awaiting_resume_build") {
    // A user who chose "build one for me" but then uploads a real file or
    // pastes a profile link clearly does have something to work from — treat
    // it exactly like the "ready" path instead of silently discarding it
    // with a generic "tell me more" (a real bug: this previously ignored
    // message.document entirely, since it only ever checked message.text).
    if (message.document || (message.text && isSupportedProfileUrl(message.text.trim()))) {
      await handleResumeUpload(chatId, conversation.userId, message, conversation.context ?? {});
      return;
    }
    if (!message.text || message.text.trim().length < MIN_BUILD_INTAKE_CHARS) {
      await sendPlainMessage(chatId, "Tell me a bit more — your current or most recent job title, your experience, and your top skills — or send your resume as a file if you have one after all.");
      return;
    }
    await handleResumeBuildIntake(chatId, conversation.userId, message.text.trim(), conversation.context ?? {});
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
    const track = (result.context.track === "general" ? "general" : "career") as "career" | "general";
    await saveSearchSettingsFromOnboarding(conversation.userId, {
      track,
      targetTitles: Array.isArray(result.context.targetTitles) ? (result.context.targetTitles as string[]) : [],
      city: result.context.city as string,
      radiusKm: result.context.radiusKm as number,
      dailyNotificationEnabled: Boolean(result.context.dailyNotificationEnabled),
      scheduledTime: (result.context.scheduledTime as string) ?? "07:30",
    });
    await sendPlainMessage(chatId, result.reply);
    if (track === "general") {
      await runGeneralWorkAndNotify(chatId, conversation.userId);
    } else {
      await runSearchAndNotify(chatId, conversation.userId);
    }
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

  if (result.nextState === "awaiting_resume_choice") {
    await sendResumeChoiceButtons(chatId, result.reply);
    return;
  }

  if (result.nextState === "awaiting_recurring_choice") {
    await sendButtonMessage(chatId, result.reply, [
      [
        { text: "Yes, daily", callback_data: "obstep:recurring:yes" },
        { text: "No, on demand", callback_data: "obstep:recurring:no" },
      ],
    ]);
    return;
  }

  await sendPlainMessage(chatId, result.reply);
}

const EDIT_USAGE =
  'Usage:\n/edit — update roles/location, radius, and daily-check schedule\n/edit track — switch between immediate/general work and career-focused work\n/edit resume — replace your resume (upload one, paste it, paste a profile link, or have me build one)';

/**
 * Re-enters onboarding at a specific point without forcing a full /start
 * over. Added after live testing showed a real gap: once onboarding
 * finished, there was no way to correct a typo'd city or change anything
 * short of re-running /start from scratch. Three forms, each re-using the
 * exact same state-machine transitions onboarding itself uses:
 *  - /edit           → titles/location → radius → recurring schedule
 *  - /edit track     → track choice (career vs. immediate/general), which
 *                      then naturally flows into resume choice and settings
 *                      again, same as first-time onboarding
 *  - /edit resume    → resume choice only, keeping the current track, then
 *                      flows into settings again once the new resume lands
 */
async function handleEditCommand(chatId: string, userId: number, subcommand: string): Promise<void> {
  const settings = await getSearchSettingsForUser(userId);
  if (!settings) {
    await sendPlainMessage(chatId, "Finish onboarding first (send /start) before editing anything.");
    return;
  }

  if (subcommand === "track") {
    await setConversationState(chatId, "awaiting_track_choice", {});
    await sendTrackChoiceButtons(chatId, `Let's update your track. Currently: ${settings.track === "general" ? "immediate/general work" : "career-focused work"}.\n\nAre you looking for immediate/general work, or career-focused work?`);
    return;
  }

  if (subcommand === "resume") {
    await setConversationState(chatId, "awaiting_resume_choice", { track: settings.track });
    await sendResumeChoiceButtons(chatId, "Let's update your resume. Do you have a new one ready to share, or would you like help building one?");
    return;
  }

  if (subcommand && subcommand !== "settings") {
    await sendPlainMessage(chatId, EDIT_USAGE);
    return;
  }

  if (settings.track === "general") {
    await setConversationState(chatId, "awaiting_location", { track: "general", targetTitles: [] });
    await sendPlainMessage(chatId, `Let's update your search settings. What city or region should I search near? (currently "${settings.city}")`);
    return;
  }

  await setConversationState(chatId, "awaiting_target_titles", { track: "career" });
  await sendPlainMessage(chatId, `Let's update your search settings. What roles are you targeting? List one or more, separated by commas. (currently: ${settings.targetTitles.join(", ") || "none set"})`);
}

async function handleResumeUpload(chatId: string, userId: number, message: TelegramIncomingMessage, context: Record<string, unknown>): Promise<void> {
  const document = message.document;
  if (document) {
    await handleResumeDocument(chatId, userId, document, context);
    return;
  }

  const pastedText = message.text?.trim();
  if (pastedText && isSupportedProfileUrl(pastedText)) {
    await handleProfileUrl(chatId, userId, pastedText, context);
    return;
  }
  if (pastedText && pastedText.length >= MIN_PASTED_RESUME_CHARS) {
    await handleResumePastedText(chatId, userId, pastedText, context);
    return;
  }

  await sendPlainMessage(chatId, "Please send your resume as a PDF or Word (.docx) file, paste the full text of your resume, or paste a public LinkedIn/Indeed profile link.");
}

async function handleProfileUrl(chatId: string, userId: number, profileUrl: string, context: Record<string, unknown>): Promise<void> {
  await sendPlainMessage(chatId, "Got it — reading your public profile now, one moment…");

  const text = await fetchPublicProfileText(profileUrl);
  if (!text) {
    await sendPlainMessage(chatId, "I couldn't read that profile — it may be private, unsupported, or the page didn't load. Please send your resume as a PDF/Word file, or paste the resume text directly instead.");
    return;
  }

  try {
    const parsed = await parseResumeText(text);
    await finishResumeIntake(chatId, userId, { ...parsed, resumeLabel: "Imported from public profile link" }, context);
  } catch (error) {
    console.error("[TelegramBot] Profile-URL parsing failed", error);
    const reason = error instanceof Error ? error.message : "something went wrong reading that profile";
    await sendPlainMessage(chatId, `I couldn't process that (${reason}). Please send your resume as a PDF/Word file, or paste the resume text directly instead.`);
  }
}

async function handleResumeDocument(chatId: string, userId: number, document: NonNullable<TelegramIncomingMessage["document"]>, context: Record<string, unknown>): Promise<void> {
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
    await finishResumeIntake(chatId, userId, profile, context);
  } catch (error) {
    console.error("[TelegramBot] Resume parsing failed", error);
    const reason = error instanceof Error ? error.message : "something went wrong reading that file";
    await sendPlainMessage(chatId, `I couldn't process that resume (${reason}). Please try sending it again.`);
  }
}

async function handleResumePastedText(chatId: string, userId: number, resumeText: string, context: Record<string, unknown>): Promise<void> {
  await sendPlainMessage(chatId, "Got it — reading your resume now, one moment…");

  try {
    const parsed = await parseResumeText(resumeText);
    await finishResumeIntake(chatId, userId, { ...parsed, resumeLabel: "Pasted resume text" }, context);
  } catch (error) {
    console.error("[TelegramBot] Pasted resume parsing failed", error);
    const reason = error instanceof Error ? error.message : "something went wrong reading that text";
    await sendPlainMessage(chatId, `I couldn't process that (${reason}). Please try pasting it again, or send it as a PDF/Word file instead.`);
  }
}

/**
 * The "build one for me" path (Phase 15): a short freeform Q&A answer
 * (job title, experience, skills, in the user's own words) rather than a
 * real resume document. Fed through the same `parseResumeText` strict-
 * JSON-schema extraction as a pasted resume — it's a different
 * conversational path, not a different extraction pipeline, since the
 * underlying LLM call already handles arbitrary unstructured input.
 */
async function handleResumeBuildIntake(chatId: string, userId: number, intakeText: string, context: Record<string, unknown>): Promise<void> {
  await sendPlainMessage(chatId, "Got it — building your profile now, one moment…");

  try {
    const parsed = await parseResumeText(intakeText);
    await finishResumeIntake(chatId, userId, { ...parsed, resumeLabel: "Built from onboarding answers" }, context);
  } catch (error) {
    console.error("[TelegramBot] Resume-build intake parsing failed", error);
    const reason = error instanceof Error ? error.message : "something went wrong building that profile";
    await sendPlainMessage(chatId, `I couldn't process that (${reason}). Tell me a bit more about your job title, experience, and skills.`);
  }
}

/**
 * Phase 13: never lets a suggestion failure block onboarding — same
 * "graceful degradation" treatment this codebase already gives to every
 * other best-effort side call (notifyOwner, public-profile fetch, PDF
 * summary fallback). A user who gets no suggestions just sees today's
 * plain "what roles are you targeting?" prompt.
 */
async function safeSuggestTargetTitles(profile: Parameters<typeof saveCandidateProfile>[1]): Promise<string[]> {
  try {
    return await suggestTargetTitles(profile);
  } catch (error) {
    console.error("[TelegramBot] Target-title suggestion failed", error);
    return [];
  }
}

async function finishResumeIntake(chatId: string, userId: number, profile: Parameters<typeof saveCandidateProfile>[1], context: Record<string, unknown>): Promise<void> {
  await saveCandidateProfile(userId, profile);
  const greeting = `Thanks, ${profile.displayName || "there"}!`;
  if (context.track === "general") {
    await setConversationState(chatId, "awaiting_location", { track: "general", targetTitles: [] });
    await sendPlainMessage(chatId, `${greeting} What city or region should I search near? (e.g. "Toronto, Ontario")`);
    return;
  }

  const suggestedTitles = await safeSuggestTargetTitles(profile);
  const nextContext: Record<string, unknown> = { track: "career" };
  let prompt = `${greeting} I've read your resume.\n\nWhat roles are you targeting? List one or more, separated by commas.`;
  if (suggestedTitles.length > 0) {
    nextContext.suggestedTargetTitles = suggestedTitles;
    prompt = `${greeting} I've read your resume.\n\nBased on it, you might target: ${suggestedTitles.join(", ")}.\n\nReply "yes" to use these, or list your own roles separated by commas.`;
  }
  await setConversationState(chatId, "awaiting_target_titles", nextContext);
  await sendPlainMessage(chatId, prompt);
}
