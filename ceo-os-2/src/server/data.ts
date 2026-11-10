import "server-only";
import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { schema, withTenant, type Tx } from "@/db";
import { buildBriefing, type BusinessSnapshot, type ConnectionState, type TaskLike } from "@/lib/briefing";
import { housecallConfiguredFor } from "./integrations/housecall-pro";
import { addDays, localDate, startOfLocalDay, startOfWeek, type DateString } from "@/lib/dates";
import { goalProgress, routineConsistency, type GoalLike, type Metrics } from "@/lib/progress";
import { buildWeeklyReview } from "@/lib/review";
import { daysListed, daysToSell, depopSnapshot, depopStats, feesFor, profitCents, type DepopItemLike } from "@/lib/depop";
import type { RoutineLike } from "@/lib/routines";
import type { AppContext } from "./context";

const STALE_AFTER_MS = 6 * 3600_000;

function toTaskLike(t: typeof schema.tasks.$inferSelect): TaskLike {
  return {
    id: t.id,
    title: t.title,
    kind: t.kind,
    scope: t.scope,
    priority: t.priority,
    status: t.status,
    dueDate: t.dueDate,
    dueAt: t.dueAt,
    snoozedUntil: t.snoozedUntil,
    contactName: t.contactName,
    createdAt: t.createdAt,
    valueCents: t.external?.amountCents ?? null,
    fromIntegration: t.source === "integration",
  };
}

function toDepopLike(i: typeof schema.depopItems.$inferSelect): DepopItemLike {
  return {
    id: i.id,
    title: i.title,
    category: i.category,
    brand: i.brand,
    size: i.size,
    costCents: i.costCents,
    listPriceCents: i.listPriceCents,
    listedOn: i.listedOn,
    soldOn: i.soldOn,
    salePriceCents: i.salePriceCents,
    feesCents: i.feesCents,
    shippingCents: i.shippingCents,
  };
}

async function depopItemsFor(tx: Tx, userId: string) {
  return tx
    .select()
    .from(schema.depopItems)
    .where(and(eq(schema.depopItems.userId, userId), isNull(schema.depopItems.removedAt)))
    .orderBy(desc(schema.depopItems.listedOn), desc(schema.depopItems.createdAt));
}

function toRoutineLike(r: typeof schema.routines.$inferSelect): RoutineLike {
  return { id: r.id, title: r.title, cadence: r.cadence, daysOfWeek: r.daysOfWeek };
}

async function integrationState(
  tx: Tx,
  userId: string,
  provider: "google_calendar" | "housecall_pro",
  staleAfterMs = STALE_AFTER_MS,
): Promise<{ state: ConnectionState; integration: typeof schema.integrations.$inferSelect | null }> {
  const [integration] = await tx
    .select()
    .from(schema.integrations)
    .where(and(eq(schema.integrations.userId, userId), eq(schema.integrations.provider, provider)))
    .limit(1);
  if (!integration || integration.status === "disconnected") return { state: "not_connected", integration: null };
  if (integration.status === "error") return { state: "error", integration };
  if (!integration.lastSyncedAt || Date.now() - integration.lastSyncedAt.getTime() > staleAfterMs) return { state: "stale", integration };
  return { state: "connected", integration };
}

const calendarState = (tx: Tx, userId: string) => integrationState(tx, userId, "google_calendar");
const HCP_STALE_MS = 30 * 60_000;

/** Housecall Pro state for this user, or not_connected when the server key isn't bound to them. */
async function housecallState(tx: Tx, ctx: AppContext) {
  if (!housecallConfiguredFor(ctx.email)) return { state: "not_connected" as ConnectionState, integration: null };
  const r = await integrationState(tx, ctx.userId, "housecall_pro", HCP_STALE_MS);
  // Configured but never synced yet: treat as stale so the first sync runs.
  if (!r.integration) return { state: "stale" as ConnectionState, integration: null, firstRun: true };
  return r;
}

async function metricsFor(tx: Tx, ctx: AppContext, today: DateString): Promise<Metrics & { lastWorkoutDate: DateString | null }> {
  const weekStart = startOfWeek(today);
  const weekStartInstant = startOfLocalDay(weekStart, ctx.timeZone);

  const [workouts] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.activities)
    .where(and(eq(schema.activities.userId, ctx.userId), eq(schema.activities.type, "workout"), gte(schema.activities.localDate, weekStart)));
  const [lastWorkout] = await tx
    .select({ d: schema.activities.localDate })
    .from(schema.activities)
    .where(and(eq(schema.activities.userId, ctx.userId), eq(schema.activities.type, "workout")))
    .orderBy(desc(schema.activities.localDate))
    .limit(1);
  const [completed] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.userId, ctx.userId), eq(schema.tasks.status, "done"), gte(schema.tasks.completedAt, weekStartInstant)));

  const routines = await tx.select().from(schema.routines).where(and(eq(schema.routines.userId, ctx.userId), isNull(schema.routines.archivedAt)));
  const completions = await tx
    .select({ routineId: schema.routineCompletions.routineId, onDate: schema.routineCompletions.onDate })
    .from(schema.routineCompletions)
    .where(and(eq(schema.routineCompletions.userId, ctx.userId), gte(schema.routineCompletions.onDate, addDays(today, -6))));
  const consistency = routineConsistency(
    routines.map((r) => ({ ...toRoutineLike(r), createdDate: localDate(r.createdAt, ctx.timeZone) })),
    completions,
    today,
  );

  return {
    workoutsThisWeek: workouts?.n ?? 0,
    tasksCompletedThisWeek: completed?.n ?? 0,
    routineConsistency7d: consistency,
    revenue: null, // No verified revenue connector yet — never estimated.
    lastWorkoutDate: lastWorkout?.d ?? null,
  };
}

/* ── Home ─────────────────────────────────────────────────────────────────── */

export async function loadHome(ctx: AppContext) {
  const now = new Date();
  const today = localDate(now, ctx.timeZone);
  return withTenant(ctx, async (tx) => {
    const tasks = await tx.select().from(schema.tasks).where(and(eq(schema.tasks.userId, ctx.userId), eq(schema.tasks.status, "open")));
    const routines = await tx.select().from(schema.routines).where(and(eq(schema.routines.userId, ctx.userId), isNull(schema.routines.archivedAt))).orderBy(asc(schema.routines.createdAt));
    const done = await tx
      .select({ routineId: schema.routineCompletions.routineId })
      .from(schema.routineCompletions)
      .where(and(eq(schema.routineCompletions.userId, ctx.userId), eq(schema.routineCompletions.onDate, today)));
    const events = await tx
      .select()
      .from(schema.calendarEvents)
      .where(and(eq(schema.calendarEvents.userId, ctx.userId), gte(schema.calendarEvents.endsAt, now), lt(schema.calendarEvents.startsAt, new Date(now.getTime() + 2 * 86_400_000))))
      .orderBy(asc(schema.calendarEvents.startsAt));
    const cal = await calendarState(tx, ctx.userId);
    const hcp = await housecallState(tx, ctx);
    const m = await metricsFor(tx, ctx, today);
    const hcpTasks = tasks.filter((t) => t.external?.provider === "housecall_pro");
    const business: BusinessSnapshot | null =
      hcp.state === "not_connected"
        ? null
        : {
            source: "Housecall Pro",
            state: hcp.state,
            awaitingEstimates: hcpTasks.filter((t) => t.external?.type === "estimate").length,
            awaitingValueCents: hcpTasks.filter((t) => t.external?.type === "estimate").reduce((sum, t) => sum + (t.external?.amountCents ?? 0), 0),
            approvedUnscheduled: hcpTasks.filter((t) => t.external?.type === "approved_estimate").length,
            jobsToSchedule: hcpTasks.filter((t) => t.external?.type === "job").length,
          };
    // The schedule comes from Google Calendar, or from Housecall Pro jobs when that's all that's connected.
    const scheduleState: ConnectionState = cal.state !== "not_connected" ? cal.state : hcp.state === "not_connected" ? "not_connected" : hcp.state === "error" ? "stale" : "connected";
    const recentWorkouts = await tx
      .select()
      .from(schema.activities)
      .where(and(eq(schema.activities.userId, ctx.userId), eq(schema.activities.type, "workout"), eq(schema.activities.localDate, today)))
      .orderBy(desc(schema.activities.occurredAt));

    const shopItems = (await depopItemsFor(tx, ctx.userId)).map(toDepopLike);
    const shop = depopSnapshot(depopStats(shopItems, today));
    const briefing = buildBriefing({
      now,
      timeZone: ctx.timeZone,
      firstName: ctx.firstName,
      tasks: tasks.map(toTaskLike),
      routines: routines.map(toRoutineLike),
      routineIdsDoneToday: new Set(done.map((d) => d.routineId)),
      events,
      workoutsThisWeek: m.workoutsThisWeek,
      weeklyWorkoutTarget: ctx.weeklyWorkoutTarget,
      lastWorkoutDate: m.lastWorkoutDate,
      calendar: scheduleState,
      business,
      depop: shop,
    });
    const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
    const [thisWeeksReview] = await tx
      .select({ approvedAt: schema.weeklyReviews.approvedAt })
      .from(schema.weeklyReviews)
      .where(and(eq(schema.weeklyReviews.userId, ctx.userId), eq(schema.weeklyReviews.weekStart, startOfWeek(today))))
      .limit(1);
    const reviewDue = !briefing.isEmpty && (weekday === 0 || weekday === 6 || weekday === 1) && !thisWeeksReview?.approvedAt;
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const priorityTasks = briefing.priorities.map((p) => {
      const t = byId.get(p.taskId)!;
      return {
        ...toTaskLike(t),
        source: t.source,
        notes: t.notes,
        reason: p.reason,
        overdue: t.dueDate !== null && t.dueDate < today,
      };
    });
    return {
      briefing,
      priorityTasks,
      calendar: scheduleState,
      scheduleSources: [cal.state !== "not_connected" ? "Google Calendar" : null, hcp.state !== "not_connected" ? "Housecall Pro" : null].filter(Boolean).join(" · "),
      needsSync: cal.state === "stale" || hcp.state === "stale",
      workoutsToday: recentWorkouts.map((w) => ({ id: w.id, label: w.label })),
      workoutsThisWeek: m.workoutsThisWeek,
      reviewDue,
    };
  });
}

/* ── Execute ──────────────────────────────────────────────────────────────── */

export type ExecuteItem = ReturnType<typeof toTaskLike> & { notes: string | null; source: string; dueAtLabel: string | null };

export async function loadExecute(ctx: AppContext) {
  const now = new Date();
  const today = localDate(now, ctx.timeZone);
  return withTenant(ctx, async (tx) => {
    const open = await tx
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.userId, ctx.userId), eq(schema.tasks.status, "open")))
      .orderBy(asc(schema.tasks.dueDate), asc(schema.tasks.dueAt), asc(schema.tasks.createdAt));
    const doneToday = await tx
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.userId, ctx.userId), eq(schema.tasks.status, "done"), gte(schema.tasks.completedAt, startOfLocalDay(today, ctx.timeZone))))
      .orderBy(desc(schema.tasks.completedAt));
    const routines = await tx.select().from(schema.routines).where(and(eq(schema.routines.userId, ctx.userId), isNull(schema.routines.archivedAt))).orderBy(asc(schema.routines.createdAt));
    const done = await tx
      .select({ routineId: schema.routineCompletions.routineId })
      .from(schema.routineCompletions)
      .where(and(eq(schema.routineCompletions.userId, ctx.userId), eq(schema.routineCompletions.onDate, today)));

    const fmt = new Intl.DateTimeFormat("en-US", { timeZone: ctx.timeZone, hour: "numeric", minute: "2-digit" });
    const item = (t: typeof schema.tasks.$inferSelect): ExecuteItem => ({
      ...toTaskLike(t),
      notes: t.notes,
      source: t.source,
      dueAtLabel: t.dueAt ? fmt.format(t.dueAt) : null,
    });
    const visible = open.filter((t) => !t.snoozedUntil || t.snoozedUntil <= now);
    const snoozed = open.filter((t) => t.snoozedUntil && t.snoozedUntil > now);
    const groups = {
      overdue: visible.filter((t) => t.dueDate && t.dueDate < today).map(item),
      today: visible.filter((t) => t.dueDate === today).map(item),
      upcoming: visible.filter((t) => t.dueDate && t.dueDate > today).map(item),
      anytime: visible.filter((t) => !t.dueDate).map(item),
      snoozed: snoozed.map(item),
    };
    const { isRoutineScheduled } = await import("@/lib/routines");
    const doneIds = new Set(done.map((d) => d.routineId));
    return {
      today,
      groups,
      doneToday: doneToday.map(item),
      routines: routines.filter((r) => isRoutineScheduled(toRoutineLike(r), today)).map((r) => ({ id: r.id, title: r.title, done: doneIds.has(r.id) })),
    };
  });
}

/* ── Growth ───────────────────────────────────────────────────────────────── */

export async function loadGrowth(ctx: AppContext) {
  const today = localDate(new Date(), ctx.timeZone);
  return withTenant(ctx, async (tx) => {
    const goals = await tx.select().from(schema.goals).where(and(eq(schema.goals.userId, ctx.userId), isNull(schema.goals.archivedAt))).orderBy(asc(schema.goals.createdAt));
    const m = await metricsFor(tx, ctx, today);
    const weekly = await weeklyActivity(tx, ctx, today);
    return {
      metrics: m,
      weekly,
      workoutTarget: ctx.weeklyWorkoutTarget,
      goals: goals.map((g) => {
        const like: GoalLike = {
          id: g.id,
          title: g.title,
          area: g.area,
          metric: g.metric,
          period: g.period,
          target: Number(g.target),
          unit: g.unit,
          manualCurrent: g.manualCurrent === null ? null : Number(g.manualCurrent),
          manualUpdatedAt: g.manualUpdatedAt,
        };
        return { ...like, progress: goalProgress(like, m) };
      }),
    };
  });
}

/** Last 8 weeks of workouts and completed tasks, for a compact trend. */
async function weeklyActivity(tx: Tx, ctx: AppContext, today: DateString) {
  const firstWeek = addDays(startOfWeek(today), -7 * 7);
  const workouts = await tx
    .select({ d: schema.activities.localDate })
    .from(schema.activities)
    .where(and(eq(schema.activities.userId, ctx.userId), eq(schema.activities.type, "workout"), gte(schema.activities.localDate, firstWeek)));
  const completed = await tx
    .select({ at: schema.tasks.completedAt })
    .from(schema.tasks)
    .where(and(eq(schema.tasks.userId, ctx.userId), eq(schema.tasks.status, "done"), gte(schema.tasks.completedAt, startOfLocalDay(firstWeek, ctx.timeZone))));
  const weeks = Array.from({ length: 8 }, (_, i) => ({ weekStart: addDays(firstWeek, i * 7), workouts: 0, tasks: 0 }));
  const idx = (d: DateString) => weeks.findIndex((w) => w.weekStart === startOfWeek(d));
  for (const w of workouts) {
    const i = idx(w.d);
    if (i >= 0) weeks[i]!.workouts++;
  }
  for (const c of completed) {
    if (!c.at) continue;
    const i = idx(localDate(c.at, ctx.timeZone));
    if (i >= 0) weeks[i]!.tasks++;
  }
  return weeks;
}

/* ── You ──────────────────────────────────────────────────────────────────── */

export async function loadYou(ctx: AppContext) {
  return withTenant(ctx, async (tx) => {
    const routines = await tx.select().from(schema.routines).where(and(eq(schema.routines.userId, ctx.userId), isNull(schema.routines.archivedAt))).orderBy(asc(schema.routines.createdAt));
    const cal = await calendarState(tx, ctx.userId);
    const hcp = await housecallState(tx, ctx);
    return {
      housecall: {
        available: housecallConfiguredFor(ctx.email),
        state: hcp.state,
        lastSyncedAt: hcp.integration?.lastSyncedAt ?? null,
        lastError: hcp.integration?.lastError ?? null,
      },
      routines: routines.map((r) => ({ id: r.id, title: r.title, cadence: r.cadence, daysOfWeek: r.daysOfWeek })),
      calendar: {
        state: cal.state,
        account: cal.integration?.accountLabel ?? null,
        lastSyncedAt: cal.integration?.lastSyncedAt ?? null,
        lastError: cal.integration?.lastError ?? null,
      },
    };
  });
}

/* ── Weekly review ────────────────────────────────────────────────────────── */

export async function loadReview(ctx: AppContext) {
  const now = new Date();
  const today = localDate(now, ctx.timeZone);
  // On Monday, review the week that just ended; otherwise the current week.
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const weekStart = weekday === 1 ? addDays(startOfWeek(today), -7) : startOfWeek(today);
  const from = startOfLocalDay(weekStart, ctx.timeZone);
  const to = startOfLocalDay(addDays(weekStart, 7), ctx.timeZone);

  return withTenant(ctx, async (tx) => {
    const completed = await tx
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.userId, ctx.userId), eq(schema.tasks.status, "done"), gte(schema.tasks.completedAt, from), lt(schema.tasks.completedAt, to)));
    const open = await tx.select().from(schema.tasks).where(and(eq(schema.tasks.userId, ctx.userId), eq(schema.tasks.status, "open")));
    const [workouts] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.activities)
      .where(
        and(eq(schema.activities.userId, ctx.userId), eq(schema.activities.type, "workout"), gte(schema.activities.localDate, weekStart), lt(schema.activities.localDate, addDays(weekStart, 7))),
      );
    const cal = await calendarState(tx, ctx.userId);
    const [meetings] = cal.integration
      ? await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(schema.calendarEvents)
          .where(and(eq(schema.calendarEvents.userId, ctx.userId), eq(schema.calendarEvents.allDay, false), gte(schema.calendarEvents.startsAt, from), lt(schema.calendarEvents.startsAt, to)))
      : [null];
    const routines = await tx.select().from(schema.routines).where(and(eq(schema.routines.userId, ctx.userId), isNull(schema.routines.archivedAt)));
    const completions = await tx
      .select({ routineId: schema.routineCompletions.routineId, onDate: schema.routineCompletions.onDate })
      .from(schema.routineCompletions)
      .where(and(eq(schema.routineCompletions.userId, ctx.userId), gte(schema.routineCompletions.onDate, weekStart)));
    const lastDay = addDays(weekStart, 6) < today ? addDays(weekStart, 6) : today;
    const consistency = routineConsistency(
      routines.map((r) => ({ ...toRoutineLike(r), createdDate: localDate(r.createdAt, ctx.timeZone) })),
      completions,
      lastDay,
      Math.min(7, Math.max(1, Math.round((Date.parse(lastDay) - Date.parse(weekStart)) / 86_400_000) + 1)),
    );
    const growth = await loadGoalsInline(tx, ctx, today);
    const [saved] = await tx
      .select()
      .from(schema.weeklyReviews)
      .where(and(eq(schema.weeklyReviews.userId, ctx.userId), eq(schema.weeklyReviews.weekStart, weekStart)))
      .limit(1);

    const summary = buildWeeklyReview({
      weekStart,
      today,
      createdDates: Object.fromEntries(open.map((t) => [t.id, localDate(t.createdAt, ctx.timeZone)])),
      completed: completed.map((t) => ({ ...toTaskLike(t), completedAt: t.completedAt! })),
      open: open.map(toTaskLike),
      workouts: workouts?.n ?? 0,
      workoutTarget: ctx.weeklyWorkoutTarget,
      routineConsistency: consistency,
      meetings: meetings ? meetings.n : null,
      goals: growth,
    });
    return { summary, approvedAt: saved?.approvedAt ?? null, reflection: saved?.reflection ?? "" };
  });
}

async function loadGoalsInline(tx: Tx, ctx: AppContext, today: DateString) {
  const goals = await tx.select().from(schema.goals).where(and(eq(schema.goals.userId, ctx.userId), isNull(schema.goals.archivedAt)));
  const m = await metricsFor(tx, ctx, today);
  return goals.map((g) => {
    const p = goalProgress(
      {
        id: g.id,
        title: g.title,
        area: g.area,
        metric: g.metric,
        period: g.period,
        target: Number(g.target),
        unit: g.unit,
        manualCurrent: g.manualCurrent === null ? null : Number(g.manualCurrent),
        manualUpdatedAt: g.manualUpdatedAt,
      },
      m,
    );
    return { title: g.title, display: p.display, provenance: p.provenance, percent: p.percent };
  });
}

/* ── Export ───────────────────────────────────────────────────────────────── */

export async function exportAll(ctx: AppContext) {
  return withTenant(ctx, async (tx) => ({
    exportedAt: new Date().toISOString(),
    account: { name: ctx.name, email: ctx.email, timeZone: ctx.timeZone },
    tasks: await tx.select().from(schema.tasks).where(eq(schema.tasks.userId, ctx.userId)),
    routines: await tx.select().from(schema.routines).where(eq(schema.routines.userId, ctx.userId)),
    routineCompletions: await tx.select().from(schema.routineCompletions).where(eq(schema.routineCompletions.userId, ctx.userId)),
    activities: await tx.select().from(schema.activities).where(eq(schema.activities.userId, ctx.userId)),
    goals: await tx.select().from(schema.goals).where(eq(schema.goals.userId, ctx.userId)),
    weeklyReviews: await tx.select().from(schema.weeklyReviews).where(eq(schema.weeklyReviews.userId, ctx.userId)),
    depopItems: await tx.select().from(schema.depopItems).where(eq(schema.depopItems.userId, ctx.userId)),
    calendarEvents: await tx
      .select({ title: schema.calendarEvents.title, startsAt: schema.calendarEvents.startsAt, endsAt: schema.calendarEvents.endsAt, source: sql<string>`'google_calendar'` })
      .from(schema.calendarEvents)
      .where(eq(schema.calendarEvents.userId, ctx.userId)),
    integrations: await tx
      .select({ provider: schema.integrations.provider, status: schema.integrations.status, account: schema.integrations.accountLabel, connectedAt: schema.integrations.createdAt })
      .from(schema.integrations)
      .where(eq(schema.integrations.userId, ctx.userId)),
  }));
}

/* ── Depop ────────────────────────────────────────────────────────────────── */

export type DepopRow = DepopItemLike & {
  notes: string | null;
  profitCents: number | null;
  feesShownCents: number;
  feesEstimated: boolean;
  daysListed: number;
  daysToSell: number | null;
};

export async function loadDepop(ctx: AppContext) {
  const today = localDate(new Date(), ctx.timeZone);
  return withTenant(ctx, async (tx) => {
    const rows = await depopItemsFor(tx, ctx.userId);
    const items = rows.map(toDepopLike);
    const stats = depopStats(items, today);
    const enrich = (r: (typeof rows)[number]): DepopRow => {
      const i = toDepopLike(r);
      const f = feesFor(i);
      return { ...i, notes: r.notes, profitCents: profitCents(i), feesShownCents: f.cents, feesEstimated: f.estimated, daysListed: daysListed(i, today), daysToSell: daysToSell(i) };
    };
    const active = rows.filter((r) => r.soldOn === null).map(enrich).sort((a, b) => b.daysListed - a.daysListed);
    const sold = rows
      .filter((r) => r.soldOn !== null)
      .map(enrich)
      .sort((a, b) => (b.soldOn! < a.soldOn! ? -1 : b.soldOn! > a.soldOn! ? 1 : 0));
    const categories = [...new Set(rows.map((r) => r.category?.trim()).filter((c): c is string => Boolean(c)))].sort();
    return { today, stats, active, sold, categories };
  });
}

/** Compact numbers for the Growth screen's Depop card. */
export async function loadDepopSummary(ctx: AppContext) {
  const today = localDate(new Date(), ctx.timeZone);
  return withTenant(ctx, async (tx) => depopStats((await depopItemsFor(tx, ctx.userId)).map(toDepopLike), today));
}
