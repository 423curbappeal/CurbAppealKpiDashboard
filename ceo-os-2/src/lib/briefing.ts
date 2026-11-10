import type { DepopSnapshot } from "./depop";
import { diffDays, formatTime, greetingFor, localParts, toDateString, type DateString } from "./dates";
import { isRoutineScheduled, type RoutineLike } from "./routines";

export interface TaskLike {
  id: string;
  title: string;
  kind: "task" | "follow_up" | "prep";
  scope: "personal" | "business";
  priority: "high" | "normal";
  status: "open" | "done" | "cancelled";
  dueDate: string | null;
  dueAt: Date | null;
  snoozedUntil: Date | null;
  contactName: string | null;
  createdAt: Date;
  /** Verified value of the underlying record (e.g. a Housecall Pro estimate), in cents. */
  valueCents?: number | null;
  /** Mirrored from a connected system (summarized separately, not re-alerted). */
  fromIntegration?: boolean;
}

export interface EventLike {
  id: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  allDay: boolean;
  location: string | null;
}

export type ConnectionState = "connected" | "error" | "stale" | "not_connected";

export interface BriefingInput {
  now: Date;
  timeZone: string;
  firstName: string;
  tasks: TaskLike[];
  routines: RoutineLike[];
  routineIdsDoneToday: Set<string>;
  events: EventLike[];
  workoutsThisWeek: number;
  weeklyWorkoutTarget: number;
  lastWorkoutDate: DateString | null;
  calendar: ConnectionState;
  /** Business system summary (Housecall Pro). Null when no business source is connected. */
  business?: BusinessSnapshot | null;
  /** Depop shop summary. Null when no items have been logged. */
  depop?: DepopSnapshot | null;
}

export interface BusinessSnapshot {
  source: string;
  state: ConnectionState;
  awaitingEstimates: number;
  awaitingValueCents: number;
  approvedUnscheduled: number;
  jobsToSchedule: number;
}

export interface Priority {
  taskId: string;
  title: string;
  reason: string;
  score: number;
  kind: TaskLike["kind"];
  scope: TaskLike["scope"];
}

export interface Alert {
  id: string;
  tone: "warning" | "info";
  text: string;
}

export interface Briefing {
  greeting: string;
  dateLabel: string;
  today: DateString;
  summary: string[];
  priorities: Priority[];
  upcoming: (EventLike & { timeLabel: string; isNext: boolean })[];
  nextEvent: (EventLike & { timeLabel: string; minutesUntil: number }) | null;
  routinesDue: (RoutineLike & { done: boolean })[];
  alerts: Alert[];
  openTaskCount: number;
  isEmpty: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dollars = (cents: number) => "$" + Math.round(cents / 100).toLocaleString("en-US");

/** Transparent scoring. Higher = more important right now. */
export function scoreTask(task: TaskLike, now: Date, today: DateString, timeZone: string): { score: number; reason: string } | null {
  if (task.status !== "open") return null;
  if (task.snoozedUntil && task.snoozedUntil > now) return null;

  let score = 0;
  let reason = "";
  const reasons: string[] = [];

  if (task.dueDate) {
    const delta = diffDays(today, task.dueDate);
    if (delta < 0) {
      score += 100 + Math.min(30, -delta * 5);
      reasons.push(`Overdue by ${plural(-delta, "day")}`);
    } else if (delta === 0) {
      if (task.dueAt) {
        const minutes = (task.dueAt.getTime() - now.getTime()) / 60000;
        score += minutes < 0 ? 105 : minutes <= 180 ? 90 : 70;
        reasons.push(minutes < 0 ? `Was due at ${formatTime(task.dueAt, timeZone)}` : `Due at ${formatTime(task.dueAt, timeZone)}`);
      } else {
        score += 70;
        reasons.push("Due today");
      }
    } else if (delta === 1) {
      score += 30;
      reasons.push("Due tomorrow");
    } else if (delta <= 7) {
      score += 12;
    } else {
      score += 2;
    }
  } else {
    score += 10;
  }

  if (task.priority === "high") {
    score += 40;
    reasons.push("You marked it high priority");
  }
  const money = task.valueCents && task.valueCents > 0 ? dollars(task.valueCents) : null;
  if (task.valueCents && task.valueCents > 0) score += Math.min(15, Math.floor(task.valueCents / 20_000)); // +1 per $200, max 15
  if (task.kind === "follow_up") {
    score += 15;
    const age = Math.floor((now.getTime() - task.createdAt.getTime()) / 86_400_000);
    if (!task.dueDate && age >= 3) {
      score += 20;
      reasons.push(`Waiting ${plural(age, "day")} for a reply${money ? ` · ${money}` : ""}`);
    } else if (reasons.length === 0) reasons.push(money ? `Open follow-up · ${money}` : "Open follow-up");
  }
  if (task.scope === "business") score += 10;

  reason = reasons[0] ?? (task.dueDate ? "Coming up this week" : "On your list");
  return { score, reason };
}

export function buildBriefing(input: BriefingInput): Briefing {
  const { now, timeZone } = input;
  const p = localParts(now, timeZone);
  const today = toDateString(p.year, p.month, p.day);
  const dateLabel = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "long", month: "long", day: "numeric" }).format(now);

  const open = input.tasks.filter((t) => t.status === "open");
  const scored = open
    .map((t) => ({ t, s: scoreTask(t, now, today, timeZone) }))
    .filter((x): x is { t: TaskLike; s: { score: number; reason: string } } => x.s !== null)
    .sort((a, b) => b.s.score - a.s.score || a.t.createdAt.getTime() - b.t.createdAt.getTime());

  const priorities: Priority[] = scored.slice(0, 3).map(({ t, s }) => ({
    taskId: t.id,
    title: t.title,
    reason: s.reason,
    score: s.score,
    kind: t.kind,
    scope: t.scope,
  }));

  const endOfToday = new Date(now.getTime() + 36 * 3600_000);
  const upcomingRaw = input.events
    .filter((e) => e.endsAt > now && e.startsAt < endOfToday)
    .filter((e) => {
      const d = toDateString(localParts(e.startsAt, timeZone).year, localParts(e.startsAt, timeZone).month, localParts(e.startsAt, timeZone).day);
      return e.allDay ? d === today || e.startsAt <= now : d === today;
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const nextTimed = upcomingRaw.find((e) => !e.allDay && e.startsAt > now) ?? null;
  const upcoming = upcomingRaw.map((e) => ({
    ...e,
    timeLabel: e.allDay ? "All day" : e.startsAt <= now ? "Now" : formatTime(e.startsAt, timeZone),
    isNext: e.id === nextTimed?.id,
  }));
  const nextEvent = nextTimed
    ? { ...nextTimed, timeLabel: formatTime(nextTimed.startsAt, timeZone), minutesUntil: Math.round((nextTimed.startsAt.getTime() - now.getTime()) / 60000) }
    : null;

  const routinesDue = input.routines
    .filter((r) => isRoutineScheduled(r, today))
    .map((r) => ({ ...r, done: input.routineIdsDoneToday.has(r.id) }));

  const overdue = scored.filter(({ t }) => t.dueDate !== null && diffDays(today, t.dueDate) < 0);
  const dueToday = scored.filter(({ t }) => t.dueDate === today);

  // ── Summary: short, factual sentences only ────────────────────────────────
  const summary: string[] = [];
  const timedToday = upcoming.filter((e) => !e.allDay);
  if (input.calendar === "connected" || input.calendar === "stale") {
    if (timedToday.length === 0) summary.push("Nothing else on your schedule today.");
    else if (nextEvent)
      summary.push(
        `${plural(timedToday.length, "appointment")} left today. Next: ${nextEvent.title} at ${nextEvent.timeLabel}.`,
      );
    else summary.push(`${plural(timedToday.length, "appointment")} in progress or remaining today.`);
  }
  const biz = input.business;
  if (biz && biz.state !== "not_connected" && biz.state !== "error") {
    const parts: string[] = [];
    if (biz.awaitingEstimates > 0) parts.push(`${plural(biz.awaitingEstimates, "estimate")} awaiting a reply (${dollars(biz.awaitingValueCents)})`);
    if (biz.approvedUnscheduled > 0) parts.push(`${biz.approvedUnscheduled} approved but not scheduled`);
    if (biz.jobsToSchedule > 0) parts.push(`${plural(biz.jobsToSchedule, "job")} to schedule`);
    if (parts.length) summary.push(`${biz.source}: ${parts.join(", ")}.`);
  }
  const shop = input.depop;
  if (shop) {
    if (shop.last7Sold > 0)
      summary.push(`Depop: ${plural(shop.last7Sold, "sale")} in the last 7 days, ${shop.last7ProfitCents < 0 ? "−" : ""}${dollars(Math.abs(shop.last7ProfitCents))} profit${shop.feesEstimated ? " (fees estimated)" : ""}. ${plural(shop.active, "listing")} active.`);
    else summary.push(`Depop: no sales in the last 7 days. ${plural(shop.active, "listing")} active.`);
  }
  if (overdue.length > 0) summary.push(`${plural(overdue.length, "task")} overdue — clear or reschedule ${overdue.length === 1 ? "it" : "them"} first.`);
  if (dueToday.length > 0) summary.push(`${plural(dueToday.length, "task")} due today.`);
  if (input.weeklyWorkoutTarget > 0) {
    const left = input.weeklyWorkoutTarget - input.workoutsThisWeek;
    summary.push(
      left > 0
        ? `${input.workoutsThisWeek} of ${input.weeklyWorkoutTarget} workouts this week.`
        : `Workout goal hit this week (${input.workoutsThisWeek}/${input.weeklyWorkoutTarget}).`,
    );
  }
  if (routinesDue.length > 0) {
    const done = routinesDue.filter((r) => r.done).length;
    summary.push(done === routinesDue.length ? "All routines done today." : `${done} of ${routinesDue.length} routines done today.`);
  }

  // ── Alerts: only things that are true and need attention ──────────────────
  const alerts: Alert[] = [];
  if (input.calendar === "error")
    alerts.push({ id: "calendar-error", tone: "warning", text: "Calendar sync failed. Appointments may be missing — reconnect in You → Connections." });
  if (biz?.state === "error")
    alerts.push({ id: "business-error", tone: "warning", text: `${biz.source} sync failed. Business follow-ups may be out of date — check You → Connections.` });
  if (input.calendar === "stale")
    alerts.push({ id: "calendar-stale", tone: "info", text: "Calendar hasn't synced recently. Showing the last known schedule." });
  if (nextEvent && nextEvent.minutesUntil <= 90)
    alerts.push({ id: `prep-${nextEvent.id}`, tone: "info", text: `${nextEvent.title} starts in ${nextEvent.minutesUntil} min${nextEvent.location ? ` · ${nextEvent.location}` : ""}.` });
  if (input.weeklyWorkoutTarget > 0 && input.lastWorkoutDate) {
    const gap = diffDays(input.lastWorkoutDate, today);
    if (gap >= 4) alerts.push({ id: "workout-gap", tone: "info", text: `No workout logged in ${gap} days.` });
  }
  const staleFollowUps = scored.filter(
    ({ t }) => t.kind === "follow_up" && !t.fromIntegration && !t.dueDate && now.getTime() - t.createdAt.getTime() > 5 * 86_400_000,
  );
  if (shop && shop.stale > 0)
    alerts.push({ id: "depop-stale", tone: "info", text: `${plural(shop.stale, "Depop listing")} up more than 60 days. A price drop or relist could move ${shop.stale === 1 ? "it" : "them"}.` });
  if (staleFollowUps.length > 1) alerts.push({ id: "stale-follow-ups", tone: "warning", text: `${staleFollowUps.length} follow-ups have been waiting more than 5 days.` });

  const isEmpty =
    open.length === 0 && input.routines.length === 0 && input.events.length === 0 && input.calendar === "not_connected" && (!biz || biz.state === "not_connected") && !shop;

  return {
    greeting: `${greetingFor(p.hour)}${input.firstName ? `, ${input.firstName}` : ""}`,
    dateLabel,
    today,
    summary,
    priorities,
    upcoming,
    nextEvent,
    routinesDue,
    alerts,
    openTaskCount: open.length,
    isEmpty,
  };
}
