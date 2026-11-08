import { describe, expect, it } from "vitest";
import { buildBriefing, type TaskLike } from "@/lib/briefing";
import { addDays, diffDays, localDate, startOfWeek, weekdayOf, zonedTimeToUtc } from "@/lib/dates";
import { goalProgress, routineConsistency, type GoalLike } from "@/lib/progress";
import { buildWeeklyReview } from "@/lib/review";

const tz = "America/New_York";
const now = zonedTimeToUtc("2026-11-09", "08:00", tz); // Monday

function task(over: Partial<TaskLike> & { id: string }): TaskLike {
  return {
    title: over.id,
    kind: "task",
    scope: "personal",
    priority: "normal",
    status: "open",
    dueDate: null,
    dueAt: null,
    snoozedUntil: null,
    contactName: null,
    createdAt: new Date(now.getTime() - 86_400_000),
    ...over,
  };
}

const baseInput = {
  now,
  timeZone: tz,
  firstName: "Alex",
  routines: [],
  routineIdsDoneToday: new Set<string>(),
  events: [],
  workoutsThisWeek: 0,
  weeklyWorkoutTarget: 0,
  lastWorkoutDate: null,
  calendar: "not_connected" as const,
};

describe("dates", () => {
  it("converts across DST correctly", () => {
    expect(zonedTimeToUtc("2026-07-01", "09:00", tz).toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(zonedTimeToUtc("2026-12-01", "09:00", tz).toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });
  it("computes weeks and weekdays", () => {
    expect(weekdayOf("2026-11-09")).toBe(1);
    expect(startOfWeek("2026-11-15")).toBe("2026-11-09");
    expect(startOfWeek("2026-11-09")).toBe("2026-11-09");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(diffDays("2026-11-09", "2026-11-12")).toBe(3);
  });
  it("finds the local date near midnight", () => {
    expect(localDate(new Date("2026-11-10T03:30:00Z"), tz)).toBe("2026-11-09");
  });
});

describe("buildBriefing", () => {
  it("is empty (no invented content) when there is no data", () => {
    const b = buildBriefing({ ...baseInput, tasks: [] });
    expect(b.isEmpty).toBe(true);
    expect(b.priorities).toEqual([]);
    expect(b.summary).toEqual([]);
    expect(b.greeting).toBe("Good morning, Alex");
  });

  it("ranks overdue, then high-priority/time-sensitive, and explains why", () => {
    const tasks = [
      task({ id: "later", dueDate: "2026-11-20" }),
      task({ id: "overdue", dueDate: "2026-11-06" }),
      task({ id: "today", dueDate: "2026-11-09" }),
      task({ id: "high", priority: "high" }),
      task({ id: "done", status: "done", dueDate: "2026-11-01" }),
    ];
    const b = buildBriefing({ ...baseInput, tasks });
    expect(b.priorities.map((p) => p.taskId)).toEqual(["overdue", "today", "high"]);
    expect(b.priorities[0]!.reason).toBe("Overdue by 3 days");
    expect(b.priorities[1]!.reason).toBe("Due today");
    expect(b.priorities[2]!.reason).toBe("You marked it high priority");
    expect(b.summary).toContain("1 task overdue — clear or reschedule it first.");
  });

  it("hides snoozed tasks until the snooze ends", () => {
    const b = buildBriefing({ ...baseInput, tasks: [task({ id: "s", dueDate: "2026-11-09", snoozedUntil: new Date(now.getTime() + 3600_000) })] });
    expect(b.priorities).toEqual([]);
  });

  it("only talks about the calendar when one is connected", () => {
    const events = [
      { id: "e1", title: "Estimate: Smith", startsAt: zonedTimeToUtc("2026-11-09", "09:00", tz), endsAt: zonedTimeToUtc("2026-11-09", "10:00", tz), allDay: false, location: "Hixson" },
      { id: "e2", title: "Tomorrow thing", startsAt: zonedTimeToUtc("2026-11-10", "09:00", tz), endsAt: zonedTimeToUtc("2026-11-10", "10:00", tz), allDay: false, location: null },
    ];
    const b = buildBriefing({ ...baseInput, tasks: [], events, calendar: "connected" });
    expect(b.upcoming.map((e) => e.id)).toEqual(["e1"]);
    expect(b.nextEvent?.minutesUntil).toBe(60);
    expect(b.summary[0]).toBe("1 appointment left today. Next: Estimate: Smith at 9:00 AM.");
    expect(b.alerts.some((a) => a.id === "prep-e1")).toBe(true);
    const noCal = buildBriefing({ ...baseInput, tasks: [task({ id: "x" })] });
    expect(noCal.summary.join(" ")).not.toMatch(/appointment/);
  });

  it("flags calendar errors and workout gaps", () => {
    const b = buildBriefing({ ...baseInput, tasks: [], calendar: "error", weeklyWorkoutTarget: 4, workoutsThisWeek: 0, lastWorkoutDate: "2026-11-03" });
    expect(b.alerts.map((a) => a.id)).toEqual(["calendar-error", "workout-gap"]);
  });
});

describe("goalProgress", () => {
  const goal = (over: Partial<GoalLike>): GoalLike => ({
    id: "g",
    title: "g",
    area: "fitness",
    metric: "workouts_per_week",
    period: "week",
    target: 4,
    unit: null,
    manualCurrent: null,
    manualUpdatedAt: null,
    ...over,
  });
  const metrics = { workoutsThisWeek: 3, tasksCompletedThisWeek: 5, routineConsistency7d: 80, revenue: null };

  it("derives fitness progress from the workout log", () => {
    expect(goalProgress(goal({}), metrics)).toMatchObject({ current: 3, percent: 75, provenance: "actual" });
  });
  it("never fabricates revenue when no source is connected", () => {
    const p = goalProgress(goal({ metric: "revenue", area: "business", target: 1_000_000, unit: "$" }), metrics);
    expect(p).toMatchObject({ current: null, percent: null, provenance: "unavailable" });
  });
  it("labels manual values as user-entered", () => {
    const p = goalProgress(goal({ metric: "manual", target: 10, unit: "books", manualCurrent: 4, manualUpdatedAt: new Date() }), metrics);
    expect(p.provenance).toBe("user_entered");
    expect(p.percent).toBe(40);
  });
});

describe("routineConsistency", () => {
  it("counts only scheduled days since the routine existed", () => {
    const routines = [{ id: "r", title: "Read", cadence: "weekdays" as const, daysOfWeek: [], createdDate: "2026-11-02" }];
    // 7 days ending Mon Nov 9: Nov 3–9 → weekdays Tue–Fri (4) + Mon 9 (1) = 5 scheduled
    const pct = routineConsistency(routines, [{ routineId: "r", onDate: "2026-11-09" }, { routineId: "r", onDate: "2026-11-05" }], "2026-11-09");
    expect(pct).toBe(40);
    expect(routineConsistency([], [], "2026-11-09")).toBeNull();
  });
});

describe("buildWeeklyReview", () => {
  it("summarizes and suggests carrying unfinished work forward", () => {
    const completedAt = new Date();
    const s = buildWeeklyReview({
      weekStart: "2026-11-02",
      today: "2026-11-08",
      createdDates: { slip: "2026-11-01", old: "2026-10-01" },
      completed: [{ ...task({ id: "c1", status: "done" }), completedAt }, { ...task({ id: "c2", status: "done", priority: "high" }), completedAt }],
      open: [task({ id: "slip", dueDate: "2026-11-05" }), task({ id: "old" })],
      workouts: 2,
      workoutTarget: 4,
      routineConsistency: 50,
      meetings: null,
      goals: [],
    });
    expect(s.headline).toBe("2 completed · 1 unfinished · 2/4 workouts");
    expect(s.completedHighlights[0]).toBe("c2");
    expect(s.suggestions.map((x) => x.id)).toEqual(["carry-slip", "decide-old"]);
    expect(s.suggestions[0]).toMatchObject({ toDate: "2026-11-09" });
    expect(s.unfinished[0]).toMatchObject({ overdueDays: 3 });
  });
});
