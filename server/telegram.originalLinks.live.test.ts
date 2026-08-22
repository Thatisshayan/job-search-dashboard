import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { telegramConnections } from "../drizzle/schema";
import { getDb } from "./db";
import { sendOriginalLinkReviewCard } from "./telegram";

const liveTest = process.env.LIVE_TELEGRAM_LINK_DELIVERY === "1" ? it : it.skip;

const selectedLinks = [
  { rank: 1, score: 100, title: "construction manager", employer: "Atlas JF Contracting Corporation", location: "Maple, ON L6A 2P2", sourceName: "Government of Canada Job Bank", originalApplyUrl: "https://www.jobbank.gc.ca/jobsearch/jobposting/50098368" },
  { rank: 2, score: 92, title: "construction project manager", employer: "Landmark Properties and Development Inc", location: "North York, ON M3C 2K5", sourceName: "Government of Canada Job Bank", originalApplyUrl: "https://www.jobbank.gc.ca/jobsearch/jobposting/49703922" },
  { rank: 3, score: 92, title: "construction project manager", employer: "Plan Group Inc", location: "Mississauga and Concord, ON", sourceName: "Government of Canada Job Bank", originalApplyUrl: "https://www.jobbank.gc.ca/jobsearch/jobposting/49961242" },
  { rank: 4, score: 91, title: "construction manager", employer: "FORYOU REAL ESTATE INC.", location: "Markham, ON L3S 0B6", sourceName: "Government of Canada Job Bank", originalApplyUrl: "https://www.jobbank.gc.ca/jobsearch/jobposting/50073218" },
  { rank: 5, score: 91, title: "project manager, construction", employer: "magnum millwork inc", location: "Burlington, ON L7L 6A6", sourceName: "Government of Canada Job Bank", originalApplyUrl: "https://www.jobbank.gc.ca/jobsearch/jobposting/50074313" },
  { rank: 6, score: 88, title: "construction project manager", employer: "Civicon", location: "Bolton, ON L7E 4G3", sourceName: "Government of Canada Job Bank", originalApplyUrl: "https://www.jobbank.gc.ca/jobsearch/jobposting/50065237" },
  { rank: 7, score: 88, title: "construction manager", employer: "Ark Group Construction Development Inc.", location: "Markham, ON L3R 3K6", sourceName: "Government of Canada Job Bank", originalApplyUrl: "https://www.jobbank.gc.ca/jobsearch/jobposting/50094677" },
  { rank: 8, score: 85, title: "construction site manager", employer: "TAGGAR CONSTRUCTION INC", location: "Mississauga, ON L5M 5A3", sourceName: "Government of Canada Job Bank", originalApplyUrl: "https://www.jobbank.gc.ca/jobsearch/jobposting/49785719" },
  { rank: 9, score: 85, title: "project manager, construction", employer: "LEGENDS INSULATION SERVICES INC", location: "Scarborough, ON M1E 5C7", sourceName: "Government of Canada Job Bank", originalApplyUrl: "https://www.jobbank.gc.ca/jobsearch/jobposting/49655766" },
  { rank: 10, score: 85, title: "assistant project manager, construction", employer: "A&R Plumbing & Mechanical Service Inc.", location: "Mississauga, ON L4X 2G6", sourceName: "Government of Canada Job Bank", originalApplyUrl: "https://www.jobbank.gc.ca/jobsearch/jobposting/49994765" },
];

describe("live Telegram original-link delivery", () => {
  liveTest("delivers individually identified original application links without submitting any employer application", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const connection = (await db.select().from(telegramConnections).where(eq(telegramConnections.userId, 1)).limit(1))[0];
    expect(connection?.chatId, "A paired Telegram chat is required").toBeTruthy();

    for (const job of selectedLinks) {
      const result = await sendOriginalLinkReviewCard({ chatId: connection!.chatId, ...job });
      expect(result.message_id).toBeTypeOf("number");
    }
  }, 30_000);
});
