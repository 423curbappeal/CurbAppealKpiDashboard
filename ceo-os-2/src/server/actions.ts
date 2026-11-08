"use server";

import { and, eq, gte } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { adminDb, schema, withTenant, type Tx } from "@/db";
import { parseCapture, type CaptureResult } from "@/lib/capture";
import { addDays, isValidTimeZone, localDate, startOfWeek, zonedTimeToUtc } from "@/lib/dates";
import { auth } from "./auth";
import { requireContext, type AppContext } from "./context";
import { loadReview } from "./data";
import { disconnectGoogleCalendar, syncGoogleCalendar } from "./integrations/google-calendar";

export type ActionResult<T = undefined> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

const id = z.string().uuid();
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^\d{2}:\d{2}$/);

function refresh() {
  revalidatePath("/", "layout");
}

async function audit(tx: Tx, ctx: AppContext, action: string, entityType: string, entityId: string | null, metadata?: Record<string, unknown>) {
  await tx.insert(schema.auditLogs).values({ orgId: ctx.orgId, userId: ctx.userId, action, entityType, entityId, metadata });
}

/* ── Capture ──────────────────────────────────────────────────────────────── */

export async function previewCapture(text: string): Promise<ActionResult<CaptureResult>> {
  const ctx = await requireContext();
  const input = z.string().trim().min(1).max(500).safeParse(text);
  if (!input.success) return { ok: false, error: "Type what you need to do." };
  const parsed = parseCapture(input.data, { now: new Date(), timeZone: ctx.timeZone });
  if (!parsed) return { ok: false, error: "I couldn't find a task in that. Try “Call Sam tomorrow at 10”." };
  return { ok: true, data: parsed };
}

const taskInput = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(2000).optional().nullable(),
  kind: z.enum(["task", "follow_up"]).default("task"),
  scope: z.enum(["personal", "business"]).default("personal"),
  priority: z.enum(["high", "normal"]).default("normal"),
  dueDate: dateStr.nullable().optional(),
  dueTime: timeStr.nullable().optional(),
  contactName: z.string().trim().max(120).nullable().optional(),
  source: z.enum(["manual", "capture"]).default("manual"),
});

export async function createTask(raw: z.input<typeof taskInput>): Promise<ActionResult<{ id: string }>> {
  const ctx = await requireContext();
  const parsed = taskInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Please check the task details." };
  const t = parsed.data;
  const dueAt = t.dueDate && t.dueTime ? zonedTimeToUtc(t.dueDate, t.dueTime, ctx.timeZone) : null;
  const [row] = await withTenant(ctx, async (tx) => {
    const r = await tx
      .insert(schema.tasks)
      .values({
        orgId: ctx.orgId,
        userId: ctx.userId,
        title: t.title,
        notes: t.notes ?? null,
        kind: t.kind,
        scope: t.scope,
        priority: t.priority,
        dueDate: t.dueDate ?? null,
        dueAt,
        contactName: t.contactName ?? null,
        source: t.source,
      })
      .returning({ id: schema.tasks.id });
    await audit(tx, ctx, "task.created", "task", r[0]!.id, { source: t.source });
    return r;
  });
  refresh();
  return { ok: true, data: { id: row!.id }, message: "Added" };
}

/* ── Task state changes ───────────────────────────────────────────────────── */

async function updateOwnTask(taskId: string, values: Partial<typeof schema.tasks.$inferInsert>, action: string) {
  const ctx = await requireContext();
  if (!id.safeParse(taskId).success) return { ok: false as const, error: "Unknown task" };
  const updated = await withTenant(ctx, async (tx) => {
    const r = await tx
      .update(schema.tasks)
      .set({ ...values, updatedAt: new Date() })
      .where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, ctx.userId)))
      .returning({ id: schema.tasks.id });
    if (r.length) await audit(tx, ctx, action, "task", taskId);
    return r.length;
  });
  if (!updated) return { ok: false as const, error: "That task no longer exists." };
  refresh();
  return { ok: true as const };
}

export async function completeTask(taskId: string): Promise<ActionResult> {
  const r = await updateOwnTask(taskId, { status: "done", completedAt: new Date(), snoozedUntil: null }, "task.completed");
  return r.ok ? { ok: true, message: "Done" } : r;
}

export async function reopenTask(taskId: string): Promise<ActionResult> {
  return updateOwnTask(taskId, { status: "open", completedAt: null }, "task.reopened");
}

export async function deleteTask(taskId: string): Promise<ActionResult> {
  const r = await updateOwnTask(taskId, { status: "cancelled" }, "task.cancelled");
  return r.ok ? { ok: true, message: "Removed" } : r;
}

const snoozeOption = z.enum(["later_today", "tomorrow", "next_week"]);

export async function snoozeTask(taskId: string, option: z.infer<typeof snoozeOption>): Promise<ActionResult> {
  const ctx = await requireContext();
  const o = snoozeOption.safeParse(option);
  if (!o.success) return { ok: false, error: "Unknown snooze option" };
  const now = new Date();
  const today = localDate(now, ctx.timeZone);
  let until: Date;
  let label: string;
  if (o.data === "later_today") {
    until = new Date(now.getTime() + 3 * 3600_000);
    label = "Snoozed 3 hours";
  } else if (o.data === "tomorrow") {
    until = zonedTimeToUtc(addDays(today, 1), "08:00", ctx.timeZone);
    label = "Snoozed until tomorrow";
  } else {
    until = zonedTimeToUtc(addDays(startOfWeek(today), 7), "08:00", ctx.timeZone);
    label = "Snoozed until Monday";
  }
  const r = await updateOwnTask(taskId, { snoozedUntil: until }, "task.snoozed");
  return r.ok ? { ok: true, message: label } : r;
}

export async function unsnoozeTask(taskId: string): Promise<ActionResult> {
  return updateOwnTask(taskId, { snoozedUntil: null }, "task.unsnoozed");
}

export async function rescheduleTask(taskId: string, dueDate: string | null, dueTime: string | null = null): Promise<ActionResult> {
  const ctx = await requireContext();
  if (dueDate !== null && !dateStr.safeParse(dueDate).success) return { ok: false, error: "Pick a valid date" };
  if (dueTime !== null && !timeStr.safeParse(dueTime).success) return { ok: false, error: "Pick a valid time" };
  const dueAt = dueDate && dueTime ? zonedTimeToUtc(dueDate, dueTime, ctx.timeZone) : null;
  const r = await updateOwnTask(taskId, { dueDate, dueAt, snoozedUntil: null }, "task.rescheduled");
  return r.ok ? { ok: true, message: dueDate ? "Rescheduled" : "Moved to Anytime" } : r;
}

export async function setTaskPriority(taskId: string, priority: "high" | "normal"): Promise<ActionResult> {
  if (priority !== "high" && priority !== "normal") return { ok: false, error: "Unknown priority" };
  return updateOwnTask(taskId, { priority }, "task.priority_changed");
}

/** "I contacted them": records a real contact activity and completes the follow-up. */
export async function markContacted(taskId: string): Promise<ActionResult<{ activityId: string }>> {
  const ctx = await requireContext();
  if (!id.safeParse(taskId).success) return { ok: false, error: "Unknown task" };
  const now = new Date();
  const result = await withTenant(ctx, async (tx) => {
    const [task] = await tx.select().from(schema.tasks).where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, ctx.userId))).limit(1);
    if (!task) return null;
    const [a] = await tx
      .insert(schema.activities)
      .values({ orgId: ctx.orgId, userId: ctx.userId, type: "contact", label: task.contactName ?? task.title, occurredAt: now, localDate: localDate(now, ctx.timeZone), relatedTaskId: task.id })
      .returning({ id: schema.activities.id });
    await tx.update(schema.tasks).set({ status: "done", completedAt: now, updatedAt: now }).where(eq(schema.tasks.id, task.id));
    await audit(tx, ctx, "contact.logged", "task", task.id);
    return a!.id;
  });
  if (!result) return { ok: false, error: "That follow-up no longer exists." };
  refresh();
  return { ok: true, data: { activityId: result }, message: "Logged as contacted" };
}

/* ── Quick actions: workouts ──────────────────────────────────────────────── */

const workoutLabel = z.string().trim().min(1).max(40);

export async function logWorkout(label: string, opts: { force?: boolean; durationMinutes?: number | null } = {}): Promise<ActionResult<{ activityId: string; duplicate?: boolean }>> {
  const ctx = await requireContext();
  const l = workoutLabel.safeParse(label);
  if (!l.success) return { ok: false, error: "Pick a workout type" };
  const duration = opts.durationMinutes == null ? null : z.number().int().min(1).max(600).safeParse(opts.durationMinutes);
  if (duration && !duration.success) return { ok: false, error: "Duration must be 1–600 minutes" };
  const now = new Date();
  const result = await withTenant(ctx, async (tx) => {
    if (!opts.force) {
      const [recent] = await tx
        .select({ id: schema.activities.id })
        .from(schema.activities)
        .where(
          and(
            eq(schema.activities.userId, ctx.userId),
            eq(schema.activities.type, "workout"),
            eq(schema.activities.label, l.data),
            gte(schema.activities.occurredAt, new Date(now.getTime() - 30 * 60_000)),
          ),
        )
        .limit(1);
      if (recent) return { duplicate: true as const, activityId: recent.id };
    }
    const [a] = await tx
      .insert(schema.activities)
      .values({
        orgId: ctx.orgId,
        userId: ctx.userId,
        type: "workout",
        label: l.data,
        occurredAt: now,
        localDate: localDate(now, ctx.timeZone),
        durationMinutes: duration?.success ? duration.data : null,
      })
      .returning({ id: schema.activities.id });
    return { duplicate: false as const, activityId: a!.id };
  });
  if (result.duplicate) return { ok: true, data: result, message: `${l.data} was already logged in the last 30 min` };
  refresh();
  return { ok: true, data: result, message: `${l.data} logged` };
}

export async function deleteActivity(activityId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!id.safeParse(activityId).success) return { ok: false, error: "Unknown entry" };
  await withTenant(ctx, async (tx) => {
    const [a] = await tx.select().from(schema.activities).where(and(eq(schema.activities.id, activityId), eq(schema.activities.userId, ctx.userId))).limit(1);
    if (!a) return;
    if (a.type === "contact" && a.relatedTaskId) {
      await tx.update(schema.tasks).set({ status: "open", completedAt: null, updatedAt: new Date() }).where(eq(schema.tasks.id, a.relatedTaskId));
    }
    await tx.delete(schema.activities).where(eq(schema.activities.id, activityId));
  });
  refresh();
  return { ok: true, message: "Undone" };
}

/* ── Routines ─────────────────────────────────────────────────────────────── */

export async function toggleRoutine(routineId: string): Promise<ActionResult<{ done: boolean }>> {
  const ctx = await requireContext();
  if (!id.safeParse(routineId).success) return { ok: false, error: "Unknown routine" };
  const today = localDate(new Date(), ctx.timeZone);
  const done = await withTenant(ctx, async (tx) => {
    const [r] = await tx.select({ id: schema.routines.id }).from(schema.routines).where(and(eq(schema.routines.id, routineId), eq(schema.routines.userId, ctx.userId))).limit(1);
    if (!r) return null;
    const removed = await tx
      .delete(schema.routineCompletions)
      .where(and(eq(schema.routineCompletions.routineId, routineId), eq(schema.routineCompletions.onDate, today)))
      .returning({ id: schema.routineCompletions.id });
    if (removed.length) return false;
    await tx.insert(schema.routineCompletions).values({ orgId: ctx.orgId, userId: ctx.userId, routineId, onDate: today }).onConflictDoNothing();
    return true;
  });
  if (done === null) return { ok: false, error: "That routine no longer exists." };
  refresh();
  return { ok: true, data: { done } };
}

const routineInput = z.object({
  title: z.string().trim().min(1).max(80),
  cadence: z.enum(["daily", "weekdays", "weekends", "custom"]),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
});

export async function createRoutine(raw: z.input<typeof routineInput>): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = routineInput.safeParse(raw);
  if (!r.success) return { ok: false, error: "Give the routine a name and schedule." };
  if (r.data.cadence === "custom" && r.data.daysOfWeek.length === 0) return { ok: false, error: "Pick at least one day." };
  await withTenant(ctx, (tx) => tx.insert(schema.routines).values({ orgId: ctx.orgId, userId: ctx.userId, ...r.data }));
  refresh();
  return { ok: true, message: "Routine added" };
}

export async function archiveRoutine(routineId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!id.safeParse(routineId).success) return { ok: false, error: "Unknown routine" };
  await withTenant(ctx, (tx) =>
    tx.update(schema.routines).set({ archivedAt: new Date() }).where(and(eq(schema.routines.id, routineId), eq(schema.routines.userId, ctx.userId))),
  );
  refresh();
  return { ok: true, message: "Routine removed" };
}

/* ── Goals ────────────────────────────────────────────────────────────────── */

const goalInput = z.object({
  title: z.string().trim().min(1).max(120),
  area: z.enum(["business", "finance", "fitness", "personal", "career"]),
  metric: z.enum(["workouts_per_week", "routine_consistency", "tasks_completed_per_week", "revenue", "manual"]),
  period: z.enum(["week", "month", "quarter", "year"]).default("year"),
  target: z.number().positive().max(1e12),
  unit: z.string().trim().max(20).nullable().optional(),
});

export async function createGoal(raw: z.input<typeof goalInput>): Promise<ActionResult> {
  const ctx = await requireContext();
  const g = goalInput.safeParse(raw);
  if (!g.success) return { ok: false, error: "Give the goal a name and a positive target." };
  if (g.data.metric === "routine_consistency" && g.data.target > 100) return { ok: false, error: "Consistency target is a percentage (1–100)." };
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .insert(schema.goals)
      .values({ orgId: ctx.orgId, userId: ctx.userId, ...g.data, target: String(g.data.target), unit: g.data.unit ?? null })
      .returning({ id: schema.goals.id });
    await audit(tx, ctx, "goal.created", "goal", row!.id, { metric: g.data.metric });
  });
  refresh();
  return { ok: true, message: "Goal added" };
}

export async function updateManualGoal(goalId: string, current: number): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!id.safeParse(goalId).success || !Number.isFinite(current) || current < 0) return { ok: false, error: "Enter a valid number" };
  const n = await withTenant(ctx, async (tx) => {
    const r = await tx
      .update(schema.goals)
      .set({ manualCurrent: String(current), manualUpdatedAt: new Date() })
      .where(and(eq(schema.goals.id, goalId), eq(schema.goals.userId, ctx.userId), eq(schema.goals.metric, "manual")))
      .returning({ id: schema.goals.id });
    if (r.length) await audit(tx, ctx, "goal.manual_updated", "goal", goalId, { current });
    return r.length;
  });
  if (!n) return { ok: false, error: "Only manual goals can be updated by hand." };
  refresh();
  return { ok: true, message: "Updated" };
}

export async function archiveGoal(goalId: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (!id.safeParse(goalId).success) return { ok: false, error: "Unknown goal" };
  await withTenant(ctx, (tx) => tx.update(schema.goals).set({ archivedAt: new Date() }).where(and(eq(schema.goals.id, goalId), eq(schema.goals.userId, ctx.userId))));
  refresh();
  return { ok: true, message: "Goal archived" };
}

/* ── Preferences ──────────────────────────────────────────────────────────── */

const prefsInput = z.object({
  timezone: z.string().refine(isValidTimeZone).optional(),
  weeklyWorkoutTarget: z.number().int().min(0).max(14).optional(),
  workoutTypes: z.array(z.string().trim().min(1).max(20)).min(1).max(8).optional(),
});

export async function updatePreferences(raw: z.input<typeof prefsInput>): Promise<ActionResult> {
  const ctx = await requireContext();
  const p = prefsInput.safeParse(raw);
  if (!p.success) return { ok: false, error: "Please check your settings." };
  await withTenant(ctx, (tx) =>
    tx
      .insert(schema.preferences)
      .values({ userId: ctx.userId, ...p.data, updatedAt: new Date() })
      .onConflictDoUpdate({ target: schema.preferences.userId, set: { ...p.data, updatedAt: new Date() } }),
  );
  refresh();
  return { ok: true, message: "Saved" };
}

/** Called once from the client with the device timezone on first launch. */
export async function adoptDeviceTimezone(tz: string): Promise<void> {
  const ctx = await requireContext();
  if (!isValidTimeZone(tz)) return;
  await withTenant(ctx, async (tx) => {
    const [p] = await tx.select().from(schema.preferences).where(eq(schema.preferences.userId, ctx.userId)).limit(1);
    if (p?.onboardedAt) return;
    await tx
      .insert(schema.preferences)
      .values({ userId: ctx.userId, timezone: tz, onboardedAt: new Date() })
      .onConflictDoUpdate({ target: schema.preferences.userId, set: { timezone: tz, onboardedAt: new Date() } });
  });
  refresh();
}

/* ── Weekly review ────────────────────────────────────────────────────────── */

export async function approveReview(input: { carryForward: string[]; drop: string[]; reflection: string }): Promise<ActionResult> {
  const ctx = await requireContext();
  const v = z
    .object({ carryForward: z.array(id).max(50), drop: z.array(id).max(50), reflection: z.string().max(4000) })
    .safeParse(input);
  if (!v.success) return { ok: false, error: "Something in the review was invalid." };
  const { summary } = await loadReview(ctx);
  // Only act on suggestions the review actually offered.
  const allowedCarry = new Map(summary.suggestions.filter((s) => s.type === "carry_forward").map((s) => [s.taskId, s]));
  const allowedDrop = new Set(summary.suggestions.map((s) => s.taskId));
  await withTenant(ctx, async (tx) => {
    for (const taskId of v.data.carryForward) {
      const s = allowedCarry.get(taskId);
      if (!s || s.type !== "carry_forward") continue;
      await tx.update(schema.tasks).set({ dueDate: s.toDate, dueAt: null, updatedAt: new Date() }).where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, ctx.userId)));
    }
    for (const taskId of v.data.drop) {
      if (!allowedDrop.has(taskId)) continue;
      await tx.update(schema.tasks).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(schema.tasks.id, taskId), eq(schema.tasks.userId, ctx.userId)));
    }
    await tx
      .insert(schema.weeklyReviews)
      .values({ orgId: ctx.orgId, userId: ctx.userId, weekStart: summary.weekStart, summary, reflection: v.data.reflection || null, approvedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.weeklyReviews.userId, schema.weeklyReviews.weekStart],
        set: { summary, reflection: v.data.reflection || null, approvedAt: new Date() },
      });
    await audit(tx, ctx, "review.approved", "weekly_review", summary.weekStart, { carried: v.data.carryForward.length, dropped: v.data.drop.length });
  });
  refresh();
  return { ok: true, message: "Week reviewed" };
}

/* ── Integrations ─────────────────────────────────────────────────────────── */

export async function syncCalendarNow(): Promise<ActionResult> {
  const ctx = await requireContext();
  const r = await syncGoogleCalendar(ctx);
  refresh();
  if ("error" in r) return { ok: false, error: r.error === "not_connected" ? "Calendar isn't connected." : r.error };
  return { ok: true, message: `Calendar synced · ${r.synced} events` };
}

export async function disconnectCalendar(): Promise<ActionResult> {
  const ctx = await requireContext();
  await disconnectGoogleCalendar(ctx);
  refresh();
  return { ok: true, message: "Google Calendar disconnected" };
}

/* ── Account ──────────────────────────────────────────────────────────────── */

export async function signOut(): Promise<void> {
  await auth().api.signOut({ headers: await headers() });
  redirect("/sign-in");
}

/**
 * Permanently deletes the user, their personal workspace and everything in it.
 * Requires typing the account email. Cascades handle dependent rows.
 */
export async function deleteAccount(confirmEmail: string): Promise<ActionResult> {
  const ctx = await requireContext();
  if (confirmEmail.trim().toLowerCase() !== ctx.email.toLowerCase()) return { ok: false, error: "Type your email exactly to confirm." };
  try {
    await disconnectGoogleCalendar(ctx);
  } catch {
    /* proceed with deletion even if revocation fails */
  }
  const db = adminDb();
  await db.transaction(async (tx) => {
    const owned = await tx
      .select({ orgId: schema.memberships.orgId })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.userId, ctx.userId), eq(schema.memberships.role, "owner")));
    for (const { orgId } of owned) {
      const members = await tx.select({ id: schema.memberships.id }).from(schema.memberships).where(eq(schema.memberships.orgId, orgId));
      if (members.length === 1) await tx.delete(schema.organizations).where(eq(schema.organizations.id, orgId));
    }
    await tx.delete(schema.user).where(eq(schema.user.id, ctx.userId));
  });
  redirect("/sign-in?deleted=1");
}
