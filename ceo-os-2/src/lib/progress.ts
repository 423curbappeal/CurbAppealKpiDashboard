import { addDays, type DateString } from "./dates";
import { isRoutineScheduled, type RoutineLike } from "./routines";

/**
 * Where a number came from. The UI must always show this.
 * - actual: derived from recorded activity or a connected source
 * - user_entered: typed in by the user
 * - unavailable: we don't have a trustworthy source yet
 */
export type Provenance = "actual" | "user_entered" | "unavailable";

export interface GoalLike {
  id: string;
  title: string;
  area: "business" | "finance" | "fitness" | "personal" | "career";
  metric: "workouts_per_week" | "routine_consistency" | "tasks_completed_per_week" | "revenue" | "manual";
  period: "week" | "month" | "quarter" | "year";
  target: number;
  unit: string | null;
  manualCurrent: number | null;
  manualUpdatedAt: Date | null;
}

export interface Metrics {
  workoutsThisWeek: number;
  tasksCompletedThisWeek: number;
  routineConsistency7d: number | null; // 0–100, null if nothing scheduled
  revenue: { amount: number; asOf: Date; source: string } | null;
}

export interface GoalProgress {
  goalId: string;
  current: number | null;
  target: number;
  percent: number | null;
  provenance: Provenance;
  sourceLabel: string;
  display: string;
}

export function formatValue(n: number, unit: string | null): string {
  if (unit === "$") return "$" + Math.round(n).toLocaleString("en-US");
  if (unit === "%") return `${Math.round(n)}%`;
  return `${Number.isInteger(n) ? n : n.toFixed(1)}${unit ? ` ${unit}` : ""}`;
}

export function goalProgress(goal: GoalLike, m: Metrics): GoalProgress {
  const pct = (cur: number) => (goal.target > 0 ? Math.max(0, Math.min(100, (cur / goal.target) * 100)) : null);
  const base = { goalId: goal.id, target: goal.target };
  switch (goal.metric) {
    case "workouts_per_week":
      return {
        ...base,
        current: m.workoutsThisWeek,
        percent: pct(m.workoutsThisWeek),
        provenance: "actual",
        sourceLabel: "From your workout log",
        display: `${m.workoutsThisWeek} of ${goal.target} this week`,
      };
    case "tasks_completed_per_week":
      return {
        ...base,
        current: m.tasksCompletedThisWeek,
        percent: pct(m.tasksCompletedThisWeek),
        provenance: "actual",
        sourceLabel: "From completed tasks",
        display: `${m.tasksCompletedThisWeek} of ${goal.target} this week`,
      };
    case "routine_consistency":
      if (m.routineConsistency7d === null)
        return { ...base, current: null, percent: null, provenance: "unavailable", sourceLabel: "No routines scheduled yet", display: "Add a routine to track this" };
      return {
        ...base,
        current: m.routineConsistency7d,
        percent: pct(m.routineConsistency7d),
        provenance: "actual",
        sourceLabel: "Last 7 days of routines",
        display: `${Math.round(m.routineConsistency7d)}% (target ${Math.round(goal.target)}%)`,
      };
    case "revenue":
      if (!m.revenue)
        return {
          ...base,
          current: null,
          percent: null,
          provenance: "unavailable",
          sourceLabel: "No revenue source connected",
          display: `Target ${formatValue(goal.target, "$")}`,
        };
      return {
        ...base,
        current: m.revenue.amount,
        percent: pct(m.revenue.amount),
        provenance: "actual",
        sourceLabel: `From ${m.revenue.source}`,
        display: `${formatValue(m.revenue.amount, "$")} of ${formatValue(goal.target, "$")}`,
      };
    case "manual":
      if (goal.manualCurrent === null)
        return { ...base, current: null, percent: null, provenance: "unavailable", sourceLabel: "Not updated yet", display: `Target ${formatValue(goal.target, goal.unit)}` };
      return {
        ...base,
        current: goal.manualCurrent,
        percent: pct(goal.manualCurrent),
        provenance: "user_entered",
        sourceLabel: goal.manualUpdatedAt
          ? `You entered this ${goal.manualUpdatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
          : "You entered this",
        display: `${formatValue(goal.manualCurrent, goal.unit)} of ${formatValue(goal.target, goal.unit)}`,
      };
  }
}

/** Percent of scheduled routine occurrences completed over the `days` ending `today`. */
export function routineConsistency(
  routines: (RoutineLike & { createdDate: DateString })[],
  completions: { routineId: string; onDate: DateString }[],
  today: DateString,
  days = 7,
): number | null {
  const done = new Set(completions.map((c) => `${c.routineId}|${c.onDate}`));
  let scheduled = 0;
  let completed = 0;
  for (let i = 0; i < days; i++) {
    const d = addDays(today, -i);
    for (const r of routines) {
      if (d < r.createdDate) continue;
      if (!isRoutineScheduled(r, d)) continue;
      scheduled++;
      if (done.has(`${r.id}|${d}`)) completed++;
    }
  }
  return scheduled === 0 ? null : (completed / scheduled) * 100;
}
