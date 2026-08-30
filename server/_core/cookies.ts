import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some(proto => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  const hostname = req.hostname ?? "";
  const isLocalDevelopmentHost =
    LOCAL_HOSTS.has(hostname) || isIpAddress(hostname);

  return {
    httpOnly: true,
    path: "/",
    // The dashboard is same-origin (client and API share one host), and the only
    // cross-site navigation into it is the OAuth callback's top-level GET redirect,
    // which SameSite=Lax still allows. Lax (vs None) stops this cookie from being
    // attached to cross-site fetch/form requests, closing a CSRF gap on owner
    // mutations (setAction, updateSettings, importVerifiedListings, ...).
    sameSite: "lax",
    // Hosted requests arrive through a TLS-terminating proxy that may not retain
    // x-forwarded-proto, so default to Secure for every non-local deployment host.
    secure: !isLocalDevelopmentHost || isSecureRequest(req),
  };
}
