import { describe, expect, it } from "vitest";
import { BOT_COMMANDS } from "../telegram";
import { HELP_TEXT } from "./handler";

describe("/help", () => {
  it("lists every registered bot command, so the autocomplete menu and /help can never drift apart", () => {
    for (const { command, description } of BOT_COMMANDS) {
      expect(HELP_TEXT).toContain(`/${command}`);
      expect(HELP_TEXT).toContain(description);
    }
  });

  it("includes the actually-implemented commands (start, watch, unwatch, watching, generalwork, help)", () => {
    const names = BOT_COMMANDS.map(c => c.command);
    expect(names).toEqual(expect.arrayContaining(["start", "watch", "unwatch", "watching", "generalwork", "help"]));
  });
});
