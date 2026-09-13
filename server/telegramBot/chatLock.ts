const locks = new Map<string, Promise<unknown>>();

/**
 * Serializes handler execution per Telegram chat, so two near-simultaneous
 * webhook deliveries for the same chat (a double-tap, a Telegram retry)
 * can't race each other's onboarding-state reads/writes. Different chats
 * still run fully concurrently — this is a per-chat lock, not a global one.
 * In-memory only, same "single in-process instance" assumption
 * scheduler.ts already documents — acceptable at current scale.
 */
export function withChatLock<T>(chatId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(chatId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  // Store a variant that never rejects for future chaining, so one call's
  // failure doesn't poison the queue for this chatId's later calls. The
  // real result (including a rejection) is still what `next` — returned to
  // this call's caller — resolves/rejects with.
  locks.set(chatId, next.catch(() => undefined));
  return next;
}
