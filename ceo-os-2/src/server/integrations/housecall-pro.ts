import "server-only";
import { and, eq, gte, inArray, like, lte, notInArray } from "drizzle-orm";
import { schema, withTenant, type TenantContext, type Tx } from "@/db";
import { zonedTimeToUtc } from "@/lib/dates";
import {
  businessKpis,
  classifyEstimate,
  kpiWindowStart,
  estimateTask,
  isUnscheduledJob,
  jobClosedReason,
  jobEvent,
  jobTask,
  type HcpEstimate,
  type HcpJob,
  type TaskDraft,
} from "@/lib/housecall";

/**
 * Housecall Pro — read-only, single-account connector.
 *
 * Housecall Pro only offers API keys (MAX plan), not OAuth. Per product rules the key is
 * never typed into an app form: it lives in the server environment (HOUSECALL_PRO_API_KEY)
 * and is bound to exactly one CEO OS account (HOUSECALL_PRO_ACCOUNT_EMAIL).
 * This connector never writes to Housecall Pro.
 */

const BASE = "https://api.housecallpro.com";
const ESTIMATE_WINDOW_DAYS = 60;
const EVENT_PAST_DAYS = 1;
const EVENT_FUTURE_DAYS = 21;

function localDateIn(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** Midnight of a local date in `timeZone`, as a UTC ISO string. */
function zonedMidnightIso(d: string, timeZone: string): string {
  return zonedTimeToUtc(d, "00:00", timeZone).toISOString();
}

export type HcpFetch = (path: string) => Promise<Response>;

export function housecallConfiguredFor(email: string | null | undefined): boolean {
  const owner = process.env.HOUSECALL_PRO_ACCOUNT_EMAIL?.trim().toLowerCase();
  return Boolean(process.env.HOUSECALL_PRO_API_KEY && owner && email && owner === email.trim().toLowerCase());
}

export const defaultHcpFetch: HcpFetch = (path) =>
  fetch(`${BASE}${path}`, {
    headers: { authorization: `Token ${process.env.HOUSECALL_PRO_API_KEY}`, accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });

async function getJson<T>(f: HcpFetch, path: string): Promise<T> {
  const res = await f(path);
  if (res.status === 401 || res.status === 403) throw new Error("Housecall Pro rejected the API key. Check HOUSECALL_PRO_API_KEY.");
  if (res.status === 429) throw new Error("Housecall Pro rate limit reached. Will retry on the next sync.");
  if (!res.ok) throw new Error(`Housecall Pro returned ${res.status}`);
  return (await res.json()) as T;
}

async function fetchRecentEstimates(f: HcpFetch, since: Date): Promise<HcpEstimate[]> {
  const out: HcpEstimate[] = [];
  for (let page = 1; page <= 5; page++) {
    const body = await getJson<{ estimates: HcpEstimate[]; total_pages: number }>(f, `/estimates?page=${page}&page_size=100&sort_direction=desc`);
    out.push(...body.estimates);
    const oldest = body.estimates.at(-1);
    if (!oldest || new Date(oldest.created_at) < since || page >= body.total_pages) break;
  }
  return out;
}

async function fetchJobs(f: HcpFetch, query: string, maxPages = 5): Promise<HcpJob[] & { cut?: boolean }> {
  const out: HcpJob[] & { cut?: boolean } = [];
  for (let page = 1; page <= maxPages; page++) {
    const body = await getJson<{ jobs: HcpJob[]; total_pages: number }>(f, `/jobs?page=${page}&page_size=100&${query}`);
    out.push(...body.jobs);
    if (page >= body.total_pages) return out;
  }
  out.cut = true;
  return out;
}

async function ensureIntegration(tx: Tx, ctx: TenantContext, label: string | null) {
  const [existing] = await tx
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, ctx.userId), eq(schema.integrations.provider, "housecall_pro")))
    .limit(1);
  if (existing) return existing;
  const [created] = await tx
    .insert(schema.integrations)
    .values({ orgId: ctx.orgId, userId: ctx.userId, provider: "housecall_pro", status: "connected", accountLabel: label, scopes: "read-only (server API key)" })
    .returning();
  await tx.insert(schema.auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "integration.connected", entityType: "integration", entityId: "housecall_pro" });
  return created!;
}

export interface HcpSyncResult {
  created: number;
  updated: number;
  closed: number;
  events: number;
}

/**
 * Pulls recent estimates and jobs, then:
 *  - creates one task per actionable record (never twice: unique on source_ref, any status)
 *  - refreshes facts on still-open tasks
 *  - closes open tasks whose record was resolved upstream, recording why
 *  - mirrors scheduled jobs into the schedule
 */
export async function syncHousecallPro(
  ctx: TenantContext & { timeZone: string },
  f: HcpFetch = defaultHcpFetch,
  now = new Date(),
): Promise<HcpSyncResult | { error: string }> {
  const existing = await withTenant(ctx, (tx) =>
    tx.select().from(schema.integrations).where(and(eq(schema.integrations.userId, ctx.userId), eq(schema.integrations.provider, "housecall_pro"))).limit(1),
  );
  if (existing[0]?.status === "disconnected") return { error: "disconnected" };

  try {
    const since = new Date(now.getTime() - ESTIMATE_WINDOW_DAYS * 86_400_000);
    const estimates = await fetchRecentEstimates(f, since);
    const unscheduled = await fetchJobs(f, "work_status%5B%5D=unscheduled");
    const min = new Date(now.getTime() - EVENT_PAST_DAYS * 86_400_000).toISOString();
    const max = new Date(now.getTime() + EVENT_FUTURE_DAYS * 86_400_000).toISOString();
    const scheduled = await fetchJobs(f, `scheduled_start_min=${encodeURIComponent(min)}&scheduled_start_max=${encodeURIComponent(max)}`);
    // KPI window: jobs scheduled from the start of the year (or last month, in January) up to now.
    const windowStart = zonedMidnightIso(kpiWindowStart(localDateIn(now, ctx.timeZone)), ctx.timeZone);
    const history = await fetchJobs(f, `scheduled_start_min=${encodeURIComponent(windowStart)}&scheduled_start_max=${encodeURIComponent(now.toISOString())}`, 20);
    const kpis = businessKpis({ completedWindowJobs: history, upcomingJobs: scheduled, estimates, now, timeZone: ctx.timeZone, cut: Boolean(history.cut) });

    // What should be open right now, keyed by source_ref.
    const wanted = new Map<string, TaskDraft>();
    const closedReasons = new Map<string, string>();
    for (const e of estimates) {
      const state = classifyEstimate(e);
      const ref = `hcp:estimate:${e.id}`;
      if (state.kind === "closed") closedReasons.set(ref, state.reason);
      else if (new Date(state.sentAt) >= since) wanted.set(ref, estimateTask(e, state));
    }
    for (const j of unscheduled) if (isUnscheduledJob(j)) wanted.set(`hcp:job:${j.id}`, jobTask(j));

    const result: HcpSyncResult = { created: 0, updated: 0, closed: 0, events: 0 };

    // Records we track but didn't see in this pull: look them up individually (bounded).
    const openTracked = await withTenant(ctx, (tx) =>
      tx
        .select({ id: schema.tasks.id, sourceRef: schema.tasks.sourceRef })
        .from(schema.tasks)
        .where(and(eq(schema.tasks.userId, ctx.userId), eq(schema.tasks.status, "open"), like(schema.tasks.sourceRef, "hcp:%"))),
    );
    for (const t of openTracked.slice(0, 40)) {
      const ref = t.sourceRef!;
      if (wanted.has(ref) || closedReasons.has(ref)) continue;
      const [, type, id] = ref.split(":");
      const res = await f(`/${type === "job" ? "jobs" : "estimates"}/${encodeURIComponent(id!)}`);
      if (res.status === 404) {
        closedReasons.set(ref, "No longer exists in Housecall Pro");
        continue;
      }
      if (!res.ok) continue; // unknown → leave it alone rather than guess
      if (type === "job") {
        const job = (await res.json()) as HcpJob;
        const reason = jobClosedReason(job);
        if (reason) closedReasons.set(ref, reason);
        else wanted.set(ref, jobTask(job));
      } else {
        const est = (await res.json()) as HcpEstimate;
        const state = classifyEstimate(est);
        if (state.kind === "closed") closedReasons.set(ref, state.reason);
        else wanted.set(ref, estimateTask(est, state));
      }
    }
    // An unscheduled job that is no longer in the unscheduled list has been scheduled (or closed).
    for (const j of scheduled) {
      const ref = `hcp:job:${j.id}`;
      if (!wanted.has(ref)) {
        const reason = jobClosedReason(j);
        if (reason) closedReasons.set(ref, reason);
      }
    }

    await withTenant(ctx, async (tx) => {
      const integration = await ensureIntegration(tx, ctx, null);
      const refs = [...new Set([...wanted.keys(), ...closedReasons.keys()])];
      const known = refs.length
        ? await tx
            .select({ id: schema.tasks.id, sourceRef: schema.tasks.sourceRef, status: schema.tasks.status, title: schema.tasks.title, notes: schema.tasks.notes })
            .from(schema.tasks)
            .where(and(eq(schema.tasks.userId, ctx.userId), inArray(schema.tasks.sourceRef, refs)))
        : [];
      const byRef = new Map(known.map((k) => [k.sourceRef!, k]));

      for (const [ref, draft] of wanted) {
        const row = byRef.get(ref);
        if (!row) {
          const inserted = await tx
            .insert(schema.tasks)
            .values({
              orgId: ctx.orgId,
              userId: ctx.userId,
              title: draft.title,
              notes: draft.notes,
              kind: draft.kind,
              scope: "business",
              contactName: draft.contactName,
              source: "integration",
              sourceRef: ref,
              external: draft.external,
              createdAt: draft.createdAt,
            })
            .onConflictDoNothing()
            .returning({ id: schema.tasks.id });
          result.created += inserted.length;
        } else if (row.status === "open" && (row.title !== draft.title || row.notes !== draft.notes)) {
          await tx
            .update(schema.tasks)
            .set({ title: draft.title, notes: draft.notes, contactName: draft.contactName, kind: draft.kind, external: draft.external, updatedAt: now })
            .where(eq(schema.tasks.id, row.id));
          result.updated++;
        }
        // Done/cancelled rows are the user's decision — never reopened or re-created.
      }

      for (const [ref, reason] of closedReasons) {
        const row = byRef.get(ref);
        if (!row || row.status !== "open") continue;
        const won = /converted|approved|scheduled/i.test(reason);
        await tx
          .update(schema.tasks)
          .set({ status: won ? "done" : "cancelled", completedAt: won ? now : null, notes: [row.notes, `Closed automatically: ${reason}`].filter(Boolean).join(" · "), updatedAt: now })
          .where(eq(schema.tasks.id, row.id));
        await tx.insert(schema.auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: "task.auto_closed", entityType: "task", entityId: row.id, metadata: { reason } });
        result.closed++;
      }

      // Scheduled jobs → schedule (deduped, pruned within the window).
      const events = scheduled.map(jobEvent).filter((e): e is NonNullable<typeof e> => e !== null);
      for (const e of events) {
        await tx
          .insert(schema.calendarEvents)
          .values({ ...e, orgId: ctx.orgId, userId: ctx.userId, integrationId: integration.id, syncedAt: now })
          .onConflictDoUpdate({
            target: [schema.calendarEvents.integrationId, schema.calendarEvents.externalId],
            set: { title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, location: e.location, syncedAt: now },
          });
      }
      const keep = events.map((e) => e.externalId);
      const inWindow = and(eq(schema.calendarEvents.integrationId, integration.id), gte(schema.calendarEvents.startsAt, new Date(min)), lte(schema.calendarEvents.startsAt, new Date(max)));
      await tx.delete(schema.calendarEvents).where(keep.length ? and(inWindow, notInArray(schema.calendarEvents.externalId, keep)) : inWindow);
      result.events = events.length;

      await tx
        .update(schema.integrations)
        .set({ status: "connected", lastSyncedAt: now, lastError: null, metrics: kpis as unknown as Record<string, unknown>, updatedAt: now })
        .where(eq(schema.integrations.id, integration.id));
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Housecall Pro sync failed";
    await withTenant(ctx, async (tx) => {
      const integration = await ensureIntegration(tx, ctx, null);
      await tx.update(schema.integrations).set({ status: "error", lastError: message.slice(0, 300), updatedAt: new Date() }).where(eq(schema.integrations.id, integration.id));
    });
    return { error: message };
  }
}

/** Stops syncing and removes mirrored jobs. Tasks already created stay (they are the user's). */
export async function setHousecallConnected(ctx: TenantContext, connected: boolean): Promise<void> {
  await withTenant(ctx, async (tx) => {
    const integration = await ensureIntegration(tx, ctx, null);
    await tx.update(schema.integrations).set({ status: connected ? "connected" : "disconnected", updatedAt: new Date() }).where(eq(schema.integrations.id, integration.id));
    if (!connected) await tx.delete(schema.calendarEvents).where(eq(schema.calendarEvents.integrationId, integration.id));
    await tx.insert(schema.auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action: connected ? "integration.connected" : "integration.disconnected", entityType: "integration", entityId: "housecall_pro" });
  });
}
