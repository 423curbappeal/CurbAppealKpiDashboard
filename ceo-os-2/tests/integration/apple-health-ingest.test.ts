import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/ceo_os_test";
const { adminDb, closeDb, schema, withTenant } = await import("@/db");
const { ensureTenancy } = await import("@/server/tenancy");
const { ingestAppleHealth, issueIngestToken, revokeIngestTokens } = await import("@/server/ingest");

const NOW = new Date("2026-11-09T15:00:00Z");
let a: { userId: string; orgId: string };
let b: { userId: string; orgId: string };
let tokenA = "";

const payload = (id: string, start = "2026-11-09 06:00:00 -0500") => ({
  data: { workouts: [{ id, name: "Traditional Strength Training", start, end: start.replace("06:00", "06:50") }] },
});

beforeAll(async () => {
  for (const id of ["ah-a", "ah-b"]) await adminDb().insert(schema.user).values({ id, name: id, email: `${id}@example.test` });
  a = { userId: "ah-a", orgId: (await ensureTenancy("ah-a", "A")).orgId };
  b = { userId: "ah-b", orgId: (await ensureTenancy("ah-b", "B")).orgId };
  tokenA = await issueIngestToken(a);
});
afterAll(async () => closeDb());

const workouts = (ctx: { userId: string; orgId: string }) =>
  withTenant(ctx, (tx) => tx.select().from(schema.activities).where(eq(schema.activities.source, "apple_health")));

describe("Apple Health ingest", () => {
  it("stores only a hash of the token", async () => {
    const rows = await adminDb().select().from(schema.ingestTokens);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(tokenA);
    expect(rows[0]!.lastFour).toBe(tokenA.slice(-4));
  });

  it("rejects missing or wrong tokens", async () => {
    expect((await ingestAppleHealth(null, payload("x"), NOW)).status).toBe(401);
    expect((await ingestAppleHealth("Bearer ceo_" + "x".repeat(43), payload("x"), NOW)).status).toBe(401);
  });

  it("imports workouts for the token owner only, with real duration", async () => {
    const r = await ingestAppleHealth(`Bearer ${tokenA}`, payload("W1"), NOW);
    expect(r).toEqual({ status: 200, body: { imported: 1, duplicates: 0, skipped: 0 } });
    const mine = await workouts(a);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ label: "Traditional Strength Training", durationMinutes: 50, localDate: "2026-11-09", externalId: "W1" });
    expect(await workouts(b)).toEqual([]);
  });

  it("never imports the same workout twice", async () => {
    const r = await ingestAppleHealth(`Bearer ${tokenA}`, payload("W1"), NOW);
    expect(r.body).toEqual({ imported: 0, duplicates: 1, skipped: 0 });
    expect(await workouts(a)).toHaveLength(1);
  });

  it("ignores workouts older than the import window or in the future", async () => {
    const r = await ingestAppleHealth(`Bearer ${tokenA}`, { workouts: [payload("old", "2026-07-01 06:00:00 -0500").data.workouts[0], payload("future", "2026-12-01 06:00:00 -0500").data.workouts[0]] }, NOW);
    expect(r.body).toMatchObject({ imported: 0, skipped: 2 });
  });

  it("stops accepting a revoked token", async () => {
    await revokeIngestTokens(a);
    expect((await ingestAppleHealth(`Bearer ${tokenA}`, payload("W2"), NOW)).status).toBe(401);
  });
});
