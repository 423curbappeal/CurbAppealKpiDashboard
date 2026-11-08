import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { HcpEstimate, HcpJob } from "@/lib/housecall";
import { estimate, job, option } from "../fixtures/housecall";

process.env.DATABASE_URL ??= "postgres://postgres:postgres@localhost:5432/ceo_os_test";
const { adminDb, closeDb, schema, withTenant } = await import("@/db");
const { ensureTenancy } = await import("@/server/tenancy");
const { syncHousecallPro } = await import("@/server/integrations/housecall-pro");

const NOW = new Date("2026-11-09T15:00:00Z");
let ctx: { userId: string; orgId: string; timeZone: string };

/** Minimal fake of the Housecall Pro API driven by in-memory records. */
function fakeHcp(state: { estimates: HcpEstimate[]; jobs: HcpJob[]; status?: number }) {
  const calls: string[] = [];
  const f = async (path: string) => {
    calls.push(path);
    if (state.status) return new Response("{}", { status: state.status });
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    const one = /^\/(estimates|jobs)\/([^?]+)$/.exec(path);
    if (one) {
      const list: { id: string }[] = one[1] === "jobs" ? state.jobs : state.estimates;
      const hit = list.find((x) => x.id === decodeURIComponent(one[2]!));
      return hit ? json(hit) : new Response("{}", { status: 404 });
    }
    if (path.startsWith("/estimates")) return json({ estimates: state.estimates, total_pages: 1 });
    if (path.includes("work_status")) return json({ jobs: state.jobs.filter((j) => j.work_status === "needs scheduling"), total_pages: 1 });
    return json({ jobs: state.jobs.filter((j) => j.schedule?.scheduled_start), total_pages: 1 });
  };
  return { f, calls };
}

const tasks = () => withTenant(ctx, (tx) => tx.select().from(schema.tasks).where(eq(schema.tasks.userId, ctx.userId)));
const byRef = async (ref: string) => (await tasks()).find((t) => t.sourceRef === ref);

beforeAll(async () => {
  await adminDb().insert(schema.user).values({ id: "owner", name: "Owner", email: "owner@example.test" });
  const { orgId } = await ensureTenancy("owner", "Owner");
  ctx = { userId: "owner", orgId, timeZone: "America/New_York" };
});
afterAll(async () => closeDb());

describe("Housecall Pro sync", () => {
  const state = {
    estimates: [
      estimate("e1"), // awaiting
      estimate("e2", { work_status: "created job from estimate" }), // closed → no task
      estimate("e3", { options: [option({ approval_status: "approved" })] }), // approved, no job
      estimate("e9", { options: [option({ created_at: "2026-07-01T00:00:00Z" })], created_at: "2026-07-01T00:00:00Z" }), // too old
    ],
    jobs: [
      job("j1"), // needs scheduling
      job("j2", { work_status: "scheduled", schedule: { scheduled_start: "2026-11-12T14:00:00Z", scheduled_end: "2026-11-12T16:00:00Z" } }),
    ],
  };

  it("creates follow-ups and schedule entries from actionable records only", async () => {
    const { f } = fakeHcp(state);
    const r = await syncHousecallPro(ctx, f, NOW);
    expect(r).toEqual({ created: 3, updated: 0, closed: 0, events: 1 });
    const all = await tasks();
    expect(all.map((t) => t.sourceRef).sort()).toEqual(["hcp:estimate:e1", "hcp:estimate:e3", "hcp:job:j1"]);
    expect(all.every((t) => t.scope === "business" && t.source === "integration")).toBe(true);
    const events = await withTenant(ctx, (tx) => tx.select().from(schema.calendarEvents));
    expect(events.map((e) => e.title)).toEqual(["House Wash · Sam Diaz"]);
  });

  it("is idempotent", async () => {
    const { f } = fakeHcp(state);
    expect(await syncHousecallPro(ctx, f, NOW)).toEqual({ created: 0, updated: 0, closed: 0, events: 1 });
    expect((await tasks()).length).toBe(3);
  });

  it("closes tasks automatically when resolved upstream, with the reason", async () => {
    state.estimates[0] = estimate("e1", { work_status: "created job from estimate" });
    state.jobs[0] = job("j1", { work_status: "scheduled", schedule: { scheduled_start: "2026-11-13T14:00:00Z", scheduled_end: "2026-11-13T15:00:00Z" } });
    const { f } = fakeHcp(state);
    const r = await syncHousecallPro(ctx, f, NOW);
    expect(r).toMatchObject({ closed: 2, events: 2 });
    expect(await byRef("hcp:estimate:e1")).toMatchObject({ status: "done" });
    expect((await byRef("hcp:estimate:e1"))!.notes).toContain("Closed automatically: Converted to a job in Housecall Pro");
    expect(await byRef("hcp:job:j1")).toMatchObject({ status: "done" });
  });

  it("looks up tracked records that dropped out of the list, and cancels on decline", async () => {
    // e3 disappears from the recent list but is declined when fetched directly.
    const e3 = estimate("e3", { options: [option({ approval_status: "declined" })] });
    const s2 = { estimates: [e3], jobs: state.jobs };
    const { f, calls } = fakeHcp({ ...s2, estimates: [] });
    const lookup = async (path: string) => (path === "/estimates/e3" ? new Response(JSON.stringify(e3), { status: 200 }) : f(path));
    const r = await syncHousecallPro(ctx, lookup, NOW);
    expect(r).toMatchObject({ closed: 1 });
    expect(await byRef("hcp:estimate:e3")).toMatchObject({ status: "cancelled" });
    expect(calls.some((c) => c.startsWith("/estimates?"))).toBe(true);
  });

  it("never re-creates a task the user dismissed", async () => {
    state.estimates = [estimate("e5")];
    let { f } = fakeHcp(state);
    await syncHousecallPro(ctx, f, NOW);
    const t = await byRef("hcp:estimate:e5");
    await withTenant(ctx, (tx) => tx.update(schema.tasks).set({ status: "cancelled" }).where(eq(schema.tasks.id, t!.id)));
    ({ f } = fakeHcp(state));
    const r = await syncHousecallPro(ctx, f, NOW);
    expect(r).toMatchObject({ created: 0 });
    expect(await byRef("hcp:estimate:e5")).toMatchObject({ status: "cancelled" });
  });

  it("records an error state instead of throwing when the key is rejected", async () => {
    const before = (await tasks()).map((t) => [t.id, t.status, t.title]);
    const { f } = fakeHcp({ estimates: [], jobs: [], status: 401 });
    const r = await syncHousecallPro(ctx, f, NOW);
    expect(r).toEqual({ error: expect.stringMatching(/rejected the API key/) });
    const [i] = await withTenant(ctx, (tx) =>
      tx.select().from(schema.integrations).where(and(eq(schema.integrations.userId, ctx.userId), eq(schema.integrations.provider, "housecall_pro"))),
    );
    expect(i).toMatchObject({ status: "error" });
    expect((await tasks()).map((t) => [t.id, t.status, t.title])).toEqual(before); // a failed sync changes nothing
  });
});
