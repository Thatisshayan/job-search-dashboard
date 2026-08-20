import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { users } from "../drizzle/schema";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { importVerifiedListingBatch, type VerifiedListing } from "./verifiedListingImport";

const liveImport = process.env.LIVE_JOBBANK_IMPORT === "1" ? it : it.skip;
const sourcePath = fileURLToPath(new URL("../research/initial_verified_jobbank_listings.json", import.meta.url));
const listings = JSON.parse(readFileSync(sourcePath, "utf8")) as Array<Omit<VerifiedListing, "postedAt" | "expiresAt"> & { postedAt: string; expiresAt?: string }>;

describe("initial verified Job Bank import", () => {
  liveImport("publishes the independently reviewed live records without any employer submission", async () => {
    const db = await getDb();
    if (!db) throw new Error("Database unavailable");
    const owner = (await db.select().from(users).where(eq(users.openId, ENV.ownerOpenId)).limit(1))[0];
    if (!owner) throw new Error("Dashboard owner not found");
    const result = await importVerifiedListingBatch(owner.id, listings.map(listing => ({
      ...listing,
      postedAt: new Date(listing.postedAt),
      expiresAt: listing.expiresAt ? new Date(listing.expiresAt) : undefined,
    })));

    expect(result.imported).toBe(listings.length);
    expect(result.shortlisted).toBeGreaterThan(0);
  }, 20_000);
});
