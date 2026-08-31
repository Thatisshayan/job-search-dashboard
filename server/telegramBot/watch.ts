import { sendPlainMessage } from "../telegram";
import { extractGreenhouseBoardToken, fetchGreenhouseBoardMeta, greenhouseBoardSourceName } from "../jobSearch/greenhouseBoard";
import { disableGreenhouseWatch, listGreenhouseWatches, registerGreenhouseWatch } from "./db";

/**
 * /watch <company> registers a second, narrower discovery source: a
 * specific company's own public Greenhouse job-board API (real, directly-
 * usable apply URLs — see jobSearch/greenhouseBoard.ts and
 * docs/telegram-agent/DECISIONS.md D5's update note for why this exists
 * alongside Adzuna's broad discovery).
 */
export async function handleWatchCommand(chatId: string, userId: number, argument: string): Promise<void> {
  const trimmed = argument.trim();
  if (!trimmed) {
    await sendPlainMessage(chatId, "Usage: /watch <company> — paste a Greenhouse job-board link (e.g. https://boards.greenhouse.io/acme) or just the company's board name (e.g. acme).");
    return;
  }

  const boardToken = extractGreenhouseBoardToken(trimmed);
  if (!boardToken) {
    await sendPlainMessage(chatId, `"${trimmed}" doesn't look like a Greenhouse board link or name. Try pasting the company's careers page URL, e.g. https://boards.greenhouse.io/acme.`);
    return;
  }

  const meta = await fetchGreenhouseBoardMeta(boardToken);
  if (!meta) {
    await sendPlainMessage(chatId, `I couldn't find a Greenhouse job board for "${boardToken}" — double-check the link or name and try again.`);
    return;
  }

  const sourceName = greenhouseBoardSourceName(boardToken);
  await registerGreenhouseWatch(userId, sourceName, boardToken, meta.name);
  await sendPlainMessage(chatId, `Watching ${meta.name}'s Greenhouse board now — I'll include their postings in your daily search alongside Adzuna. Say /unwatch ${boardToken} to stop.`);
}

export async function handleUnwatchCommand(chatId: string, userId: number, argument: string): Promise<void> {
  const trimmed = argument.trim();
  if (!trimmed) {
    await sendPlainMessage(chatId, "Usage: /unwatch <company> — the same name or link you used with /watch.");
    return;
  }

  const boardToken = extractGreenhouseBoardToken(trimmed);
  if (!boardToken) {
    await sendPlainMessage(chatId, `"${trimmed}" doesn't look like a Greenhouse board link or name.`);
    return;
  }

  const removed = await disableGreenhouseWatch(userId, greenhouseBoardSourceName(boardToken));
  await sendPlainMessage(chatId, removed ? `Stopped watching that board.` : `You weren't watching "${boardToken}".`);
}

export async function handleWatchingCommand(chatId: string, userId: number): Promise<void> {
  const watches = await listGreenhouseWatches(userId);
  if (watches.length === 0) {
    await sendPlainMessage(chatId, "You're not watching any company Greenhouse boards yet. Try /watch <company>.");
    return;
  }
  const lines = watches.map(watch => `• ${watch.lastStatus?.replace(/^Watching /, "").replace(/'s Greenhouse board$/, "") ?? watch.name}`);
  await sendPlainMessage(chatId, `Watching:\n${lines.join("\n")}`);
}
