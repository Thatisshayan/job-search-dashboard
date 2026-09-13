import { describe, expect, it } from "vitest";
import { withChatLock } from "./chatLock";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("withChatLock", () => {
  it("serializes calls for the same chatId", async () => {
    const order: string[] = [];
    const first = deferred<void>();

    const call1 = withChatLock("chat-1", async () => {
      order.push("call1-start");
      await first.promise;
      order.push("call1-end");
    });
    const call2 = withChatLock("chat-1", async () => {
      order.push("call2-start");
    });

    // call2 must not have started yet -- it's queued behind call1.
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toEqual(["call1-start"]);

    first.resolve();
    await call1;
    await call2;

    expect(order).toEqual(["call1-start", "call1-end", "call2-start"]);
  });

  it("runs calls for different chatIds concurrently", async () => {
    const order: string[] = [];
    const first = deferred<void>();

    const call1 = withChatLock("chat-1", async () => {
      order.push("chat1-start");
      await first.promise;
      order.push("chat1-end");
    });
    const call2 = withChatLock("chat-2", async () => {
      order.push("chat2-start");
    });

    await call2; // chat-2's call completes without waiting on chat-1's lock
    expect(order).toEqual(["chat1-start", "chat2-start"]);

    first.resolve();
    await call1;
  });

  it("a rejected call doesn't block later calls for the same chatId", async () => {
    await expect(
      withChatLock("chat-3", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    const result = await withChatLock("chat-3", async () => "ok");
    expect(result).toBe("ok");
  });
});
