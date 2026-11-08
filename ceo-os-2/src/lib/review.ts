import { addDays, diffDays, type DateString } from "./dates";
import type { TaskLike } from "./briefing";

export interface ReviewInput {
  weekStart: DateString; // Monday
  today: DateString;
  /** Local calendar day each open task was created (user's timezone). */
  createdDates: Record<string, DateString>;
  completed: (TaskLike & { completedAt: Date })[];
  open: TaskLike[];
  workouts: number;
  workoutTarget: number;
  routineConsistency: number | null;
  meetings: number | null; // null when no calendar is connected
  goals: { title: string; display: string; provenance: string; percent: number | null }[];
}

export type Suggestion =
  | { id: string; type: "carry_forward"; taskId: string; title: string; toDate: DateString; label: string }
  | { id: string; type: "decide"; taskId: string; title: string; label: string };

export interface WeeklySummary {
  weekStart: DateString;
  weekEnd: DateString;
  headline: string;
  completedCount: number;
  completedHighlights: string[];
  unfinished: { taskId: string; title: string; overdueDays: number }[];
  habits: { workouts: number; workoutTarget: number; routineConsistency: number | null };
  meetings: number | null;
  goals: ReviewInput["goals"];
  suggestions: Suggestion[];
  focusIdeas: string[];
}

export function buildWeeklyReview(input: ReviewInput): WeeklySummary {
  const weekEnd = addDays(input.weekStart, 6);
  const nextMonday = addDays(input.weekStart, 7);

  const highlights = [...input.completed]
    .sort((a, b) =>
      a.priority === b.priority ? b.completedAt.getTime() - a.completedAt.getTime() : a.priority === "high" ? -1 : 1,
    )
    .slice(0, 5)
    .map((t) => t.title);

  const slipped = input.open.filter((t) => t.dueDate !== null && t.dueDate <= weekEnd);
  const unfinished = slipped
    .map((t) => ({ taskId: t.id, title: t.title, overdueDays: Math.max(0, diffDays(t.dueDate!, input.today)) }))
    .sort((a, b) => b.overdueDays - a.overdueDays);

  const suggestions: Suggestion[] = [];
  for (const t of slipped.slice(0, 8)) {
    suggestions.push({
      id: `carry-${t.id}`,
      type: "carry_forward",
      taskId: t.id,
      title: t.title,
      toDate: nextMonday,
      label: `Move to Monday`,
    });
  }
  const slippedIds = new Set(slipped.map((t) => t.id));
  const ancient = input.open.filter((t) => {
    const created = input.createdDates[t.id];
    return !slippedIds.has(t.id) && created !== undefined && diffDays(created, input.today) >= 21;
  });
  for (const t of ancient.slice(0, 4)) {
    suggestions.push({ id: `decide-${t.id}`, type: "decide", taskId: t.id, title: t.title, label: "Open 3+ weeks — keep or drop?" });
  }

  const focusIdeas: string[] = [];
  if (input.workoutTarget > 0 && input.workouts < input.workoutTarget) {
    const gap = input.workoutTarget - input.workouts;
    focusIdeas.push(`You were ${gap} workout${gap === 1 ? "" : "s"} short of your target. Put sessions on the calendar.`);
  }
  if (unfinished.length >= 3) focusIdeas.push("Several commitments slipped. Choose fewer top priorities next week.");
  if (input.routineConsistency !== null && input.routineConsistency < 60)
    focusIdeas.push("Routines were under 60%. Consider trimming to the ones that matter most.");
  for (const t of input.open.filter((t) => t.priority === "high").slice(0, 2)) focusIdeas.push(`Move "${t.title}" forward.`);

  const parts = [`${input.completed.length} completed`];
  if (unfinished.length) parts.push(`${unfinished.length} unfinished`);
  if (input.workoutTarget > 0) parts.push(`${input.workouts}/${input.workoutTarget} workouts`);

  return {
    weekStart: input.weekStart,
    weekEnd,
    headline: parts.join(" · "),
    completedCount: input.completed.length,
    completedHighlights: highlights,
    unfinished,
    habits: { workouts: input.workouts, workoutTarget: input.workoutTarget, routineConsistency: input.routineConsistency },
    meetings: input.meetings,
    goals: input.goals,
    suggestions,
    focusIdeas: focusIdeas.slice(0, 4),
  };
}
