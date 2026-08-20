import { describe, expect, it } from "vitest";
import { getSessionCookieOptions } from "./cookies";

function requestFor(hostname: string, protocol = "http", forwardedProto?: string) {
  return {
    hostname,
    protocol,
    headers: forwardedProto ? { "x-forwarded-proto": forwardedProto } : {},
  } as any;
}

describe("getSessionCookieOptions", () => {
  it("issues Secure SameSite=None cookies for a hosted deployment even if proxy headers are absent", () => {
    const options = getSessionCookieOptions(requestFor("shayanjobdas-m9vovfma.manus.space"));
    expect(options).toMatchObject({ httpOnly: true, path: "/", sameSite: "none", secure: true });
  });

  it("keeps localhost usable without forcing Secure cookies", () => {
    const options = getSessionCookieOptions(requestFor("localhost"));
    expect(options.secure).toBe(false);
  });
});
