import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/ceo_os_test";

const { adminDb, closeDb, schema, withTenant } = await import("@/db");
const { ensureTenancy } = await import("@/server/tenancy");

type Ctx = { userId: string; orgId: string };
let alice: Ctx;
let bob: Ctx;

async function makeUser(id: string, name: string): Promise<Ctx> {
  await adminDb().insert(schema.user).values({ id, name, email: `${id}@example.test` });
  const { orgId } = await ensureTenancy(id, name);
  return { userId: id, orgId };
}

beforeAll(async () => {
  alice = await makeUser("alice", "Alice Owner");
  bob = await makeUser("bob", "Bob Other");
});

afterAll(async () => {
  await closeDb();
});

describe("tenancy bootstrap", () => {
  it("is idempotent and gives each user a separate personal org", async () => {
    const again = await ensureTenancy("alice", "Alice Owner");
    expect(again.orgId).toBe(alice.orgId);
    expect(alice.orgId).not.toBe(bob.orgId);
  });
});

describe("row-level security", () => {
  it("users only see their own tasks", async () => {
    await withTenant(alice, (tx) => tx.insert(schema.tasks).values({ orgId: alice.orgId, userId: alice.userId, title: "Alice secret" }));
    const bobSees = await withTenant(bob, (tx) => tx.select().from(schema.tasks));
    expect(bobSees).toEqual([]);
    const aliceSees = await withTenant(alice, (tx) => tx.select().from(schema.tasks));
    expect(aliceSees.map((t) => t.title)).toEqual(["Alice secret"]);
  });

  it("cannot update or delete another user's row even with its id", async () => {
    const [task] = await withTenant(alice, (tx) => tx.select().from(schema.tasks));
    const updated = await withTenant(bob, (tx) => tx.update(schema.tasks).set({ title: "pwned" }).where(eq(schema.tasks.id, task!.id)).returning());
    expect(updated).toEqual([]);
    const deleted = await withTenant(bob, (tx) => tx.delete(schema.tasks).where(eq(schema.tasks.id, task!.id)).returning());
    expect(deleted).toEqual([]);
    const [still] = await withTenant(alice, (tx) => tx.select().from(schema.tasks).where(eq(schema.tasks.id, task!.id)));
    expect(still?.title).toBe("Alice secret");
  });

  it("rejects inserting rows into another tenant", async () => {
    await expect(
      withTenant(bob, (tx) => tx.insert(schema.tasks).values({ orgId: alice.orgId, userId: alice.userId, title: "injected" })),
    ).rejects.toThrow();
    await expect(
      withTenant(bob, (tx) => tx.insert(schema.tasks).values({ orgId: alice.orgId, userId: bob.userId, title: "injected" })),
    ).rejects.toThrow();
  });

  it("cannot move a row into another tenant via update", async () => {
    const [own] = await withTenant(bob, (tx) => tx.insert(schema.tasks).values({ orgId: bob.orgId, userId: bob.userId, title: "Bob task" }).returning());
    await expect(withTenant(bob, (tx) => tx.update(schema.tasks).set({ orgId: alice.orgId }).where(eq(schema.tasks.id, own!.id)))).rejects.toThrow();
  });

  it("isolates every domain table", async () => {
    await withTenant(alice, async (tx) => {
      const [r] = await tx.insert(schema.routines).values({ orgId: alice.orgId, userId: alice.userId, title: "Read" }).returning();
      await tx.insert(schema.routineCompletions).values({ orgId: alice.orgId, userId: alice.userId, routineId: r!.id, onDate: "2026-11-09" });
      await tx.insert(schema.activities).values({ orgId: alice.orgId, userId: alice.userId, type: "workout", label: "Push", localDate: "2026-11-09" });
      await tx.insert(schema.goals).values({ orgId: alice.orgId, userId: alice.userId, title: "Rev", area: "business", metric: "revenue", target: "1000000" });
      const [i] = await tx.insert(schema.integrations).values({ orgId: alice.orgId, userId: alice.userId, provider: "google_calendar", encryptedTokens: "v1.x.y.z" }).returning();
      await tx.insert(schema.calendarEvents).values({ orgId: alice.orgId, userId: alice.userId, integrationId: i!.id, externalId: "e1", title: "Meeting", startsAt: new Date(), endsAt: new Date() });
      await tx.insert(schema.weeklyReviews).values({ orgId: alice.orgId, userId: alice.userId, weekStart: "2026-11-02", summary: {} });
      await tx.insert(schema.auditLogs).values({ orgId: alice.orgId, userId: alice.userId, action: "test", entityType: "test" });
      await tx.insert(schema.depopItems).values({ orgId: alice.orgId, userId: alice.userId, title: "Carhartt jacket", costCents: 1200, listedOn: "2026-11-01" });
    });
    const counts = await withTenant(bob, async (tx) => ({
      routines: (await tx.select().from(schema.routines)).length,
      completions: (await tx.select().from(schema.routineCompletions)).length,
      activities: (await tx.select().from(schema.activities)).length,
      goals: (await tx.select().from(schema.goals)).length,
      integrations: (await tx.select().from(schema.integrations)).length,
      events: (await tx.select().from(schema.calendarEvents)).length,
      reviews: (await tx.select().from(schema.weeklyReviews)).length,
      depop: (await tx.select().from(schema.depopItems)).length,
      audit: (await tx.select().from(schema.auditLogs).where(eq(schema.auditLogs.orgId, alice.orgId))).length,
      orgs: (await tx.select().from(schema.organizations)).map((o) => o.id),
      memberships: (await tx.select().from(schema.memberships)).map((m) => m.userId),
    }));
    expect(counts).toEqual({ routines: 0, completions: 0, activities: 0, goals: 0, integrations: 0, events: 0, reviews: 0, depop: 0, audit: 0, orgs: [bob.orgId], memberships: ["bob"] });
  });

  it("keeps Depop items private and rejects writes into another tenant", async () => {
    const [own] = await withTenant(alice, (tx) => tx.select().from(schema.depopItems));
    expect(own?.title).toBe("Carhartt jacket");
    const updated = await withTenant(bob, (tx) => tx.update(schema.depopItems).set({ salePriceCents: 1 }).where(eq(schema.depopItems.id, own!.id)).returning());
    expect(updated).toEqual([]);
    await expect(
      withTenant(bob, (tx) => tx.insert(schema.depopItems).values({ orgId: alice.orgId, userId: alice.userId, title: "injected", listedOn: "2026-11-01" })),
    ).rejects.toThrow();
  });

  it("restricted role cannot read auth tables (passwords, sessions)", async () => {
    const denied = { cause: expect.objectContaining({ message: expect.stringMatching(/permission denied/) }) };
    await expect(withTenant(bob, (tx) => tx.select().from(schema.account))).rejects.toMatchObject(denied);
    await expect(withTenant(bob, (tx) => tx.select().from(schema.session))).rejects.toMatchObject(denied);
  });

  it("sees nothing when the tenant settings are missing", async () => {
    const rows = await adminDb().transaction(async (tx) => {
      await tx.execute(sql`set local role ceo_os_app`);
      return tx.select().from(schema.tasks);
    });
    expect(rows).toEqual([]);
  });

  it("refuses to run without a complete context", async () => {
    await expect(withTenant({ userId: "", orgId: alice.orgId }, async () => 1)).rejects.toThrow(/incomplete/);
  });
});

describe("account deletion", () => {
  it("cascades all of a user's data", async () => {
    const carol = await makeUser("carol", "Carol");
    await withTenant(carol, (tx) => tx.insert(schema.tasks).values({ orgId: carol.orgId, userId: carol.userId, title: "c" }));
    await adminDb().delete(schema.organizations).where(eq(schema.organizations.id, carol.orgId));
    await adminDb().delete(schema.user).where(eq(schema.user.id, "carol"));
    const [{ n }] = (await adminDb().execute(sql`select count(*)::int as n from tasks where user_id = 'carol'`)) as unknown as [{ n: number }];
    expect(n).toBe(0);
  });
});
