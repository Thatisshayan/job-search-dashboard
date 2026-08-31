import { z } from "zod";

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  openRouterApiKey: process.env.OPENROUTER_API_KEY ?? "",
  openRouterBaseUrl: process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1",
  adzunaAppId: process.env.ADZUNA_APP_ID ?? "",
  adzunaAppKey: process.env.ADZUNA_APP_KEY ?? "",
};

const requiredEnvSchema = z.object({
  VITE_APP_ID: z.string().trim().min(1, "VITE_APP_ID is required"),
  JWT_SECRET: z.string().trim().min(1, "JWT_SECRET is required"),
  DATABASE_URL: z.string().trim().min(1, "DATABASE_URL is required"),
  OAUTH_SERVER_URL: z.string().trim().min(1, "OAUTH_SERVER_URL is required"),
  OWNER_OPEN_ID: z.string().trim().min(1, "OWNER_OPEN_ID is required"),
});

/**
 * Fails fast at startup instead of letting the server boot and only discover a
 * missing variable on the first request that touches it (the root cause behind
 * several past "recovery publish" deploys).
 */
export function assertRequiredEnv() {
  const result = requiredEnvSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues
      .map(issue => issue.path.join("."))
      .join(", ");
    throw new Error(
      `Missing or empty required environment variable(s): ${missing}`
    );
  }
}
