import { z } from "zod";
import {
  getDashboardOverview,
  ensurePublicWorkspaceInitialized,
  getProfile,
  getSettings,
  listJobHistory,
  listRuns,
  listShortlist,
  setJobAction,
  updateSourceEnabled,
  updateSettings,
} from "./db";
import { scoreJob } from "./scoring";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { COOKIE_NAME } from "@shared/const";
import { TRPCError } from "@trpc/server";
import { ENV } from "./_core/env";
import { prepareApplicationForTelegram } from "./applicationService";
import { importVerifiedListingBatch } from "./verifiedListingImport";
import { isWorkspaceOwner } from "./ownerAccess";

const settingInput = z.object({
  targetTitles: z.array(z.string().trim().min(2)).min(1).max(20),
  city: z.string().trim().min(2).max(120),
  radiusKm: z.number().int().min(1).max(250),
  employmentTypes: z.array(z.string().trim().min(2)).min(1).max(5),
  minimumScore: z.number().int().min(0).max(100),
  shortlistLimit: z.number().int().min(1).max(20),
  scheduledTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  dailyNotificationEnabled: z.boolean(),
});

const verifiedListingInput = z.object({
  sourceName: z.string().trim().min(2).max(120),
  sourceExternalId: z.string().trim().min(1).max(255).optional(),
  sourcePostingUrl: z.string().url(),
  originalApplyUrl: z.string().url(),
  title: z.string().trim().min(2).max(255),
  employer: z.string().trim().min(2).max(255),
  location: z.string().trim().min(2).max(255),
  locationKm: z.number().int().min(0).max(250).optional(),
  employmentType: z.literal("full-time"),
  description: z.string().trim().min(80),
  postedAt: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),
  seniorityMatch: z.enum(["strong", "partial", "weak"]),
  verificationNote: z.string().trim().min(20).max(1000),
});

function getLocalDateKey(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(
    parts.filter(part => part.type !== "literal").map(part => [part.type, part.value]),
  ) as Record<string, string>;
  return `${value.year}-${value.month}-${value.day}`;
}

const ownerProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!isWorkspaceOwner(ctx.user, ENV.ownerOpenId)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "This private dashboard is restricted to its owner." });
  }
  return next({ ctx });
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  dashboard: router({
    accessStatus: protectedProcedure.query(({ ctx }) => ({ isOwner: isWorkspaceOwner(ctx.user, ENV.ownerOpenId) })),
    overview: publicProcedure.query(async () => getDashboardOverview(await ensurePublicWorkspaceInitialized())),
    shortlist: publicProcedure.input(z.object({ dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() })).query(async ({ input }) =>
      listShortlist(await ensurePublicWorkspaceInitialized(), input.dateKey ?? getLocalDateKey("America/Toronto")),
    ),
    history: publicProcedure.query(async () => listJobHistory(await ensurePublicWorkspaceInitialized())),
    runs: publicProcedure.query(async () => listRuns(await ensurePublicWorkspaceInitialized())),
    profile: publicProcedure.query(async () => getProfile(await ensurePublicWorkspaceInitialized())),
    settings: publicProcedure.query(async () => getSettings(await ensurePublicWorkspaceInitialized())),
    updateSettings: ownerProcedure.input(settingInput).mutation(({ ctx, input }) => updateSettings(ctx.user.id, input)),
    setSourceEnabled: ownerProcedure.input(z.object({ sourceId: z.number().int().positive(), enabled: z.boolean() })).mutation(({ ctx, input }) => updateSourceEnabled(ctx.user.id, input.sourceId, input.enabled)),
    setAction: ownerProcedure
      .input(z.object({ jobId: z.number().int().positive(), status: z.enum(["none", "saved", "opened", "applied", "not_interested", "reported_stale"]) }))
      .mutation(async ({ ctx, input }) => {
        await setJobAction(ctx.user.id, input.jobId, input.status);
        return { success: true };
      }),
    prepareApplication: ownerProcedure
      .input(z.object({ jobId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        const application = await prepareApplicationForTelegram(ctx.user.id, input.jobId);
        return { application };
      }),
    importVerifiedListings: ownerProcedure
      .input(z.object({ listings: z.array(verifiedListingInput).min(1).max(20) }))
      .mutation(({ ctx, input }) => importVerifiedListingBatch(ctx.user.id, input.listings)),
    previewScore: ownerProcedure
      .input(z.object({
        title: z.string(), description: z.string(), employmentType: z.string().optional(), location: z.string().optional(), locationKm: z.number().int().optional(), originalApplyUrl: z.string().url().optional(), postedAt: z.date().optional(), status: z.enum(["active", "expired", "unavailable", "stale"]).optional(), skillMatches: z.array(z.string()).optional(), seniorityMatch: z.enum(["strong", "partial", "weak"]).optional(), isDuplicate: z.boolean().optional(),
      }))
      .query(({ input }) => scoreJob(input)),
  }),
});

export type AppRouter = typeof appRouter;
