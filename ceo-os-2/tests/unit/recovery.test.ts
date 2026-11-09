import { describe, expect, it } from "vitest";
import { classifyWorkout, computeRecovery, needsFocus } from "@/lib/recovery";

const now = new Date("2026-11-09T15:00:00Z");
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
const types = ["Push", "Pull", "Legs", "Cardio"];

describe("classifyWorkout", () => {
  it("maps quick-log and Apple Watch activity names", () => {
    expect(classifyWorkout("Push").load.chest).toBe(1);
    expect(classifyWorkout("Legs").load.quads).toBe(1);
    expect(classifyWorkout("Outdoor Run").cardio).toBe(true);
    expect(classifyWorkout("Indoor Cycling").cardio).toBe(true);
    expect(classifyWorkout("High Intensity Interval Training").cardio).toBe(true);
    expect(classifyWorkout("Yoga")).toMatchObject({ known: true, load: {} });
    expect(classifyWorkout("Pickleball").known).toBe(false);
  });
  it("does not guess which muscles an untagged strength import worked", () => {
    expect(needsFocus({ label: "Traditional Strength Training", focus: null })).toBe(true);
    expect(needsFocus({ label: "Traditional Strength Training", focus: "Pull" })).toBe(false);
    expect(needsFocus({ label: "Push", focus: null })).toBe(false);
  });
});

describe("computeRecovery", () => {
  it("marks yesterday's push muscles as recovering and suggests something else", () => {
    const r = computeRecovery(
      [
        { label: "Push", occurredAt: ago(20), durationMinutes: null },
        { label: "Legs", occurredAt: ago(6 * 24), durationMinutes: 50 },
        { label: "Pull", occurredAt: ago(3 * 24), durationMinutes: 45 },
      ],
      now,
      { workoutTypes: types },
    );
    expect(r.muscles.chest.status).not.toBe("ready");
    expect(r.muscles.chest.hoursUntilReady).toBeGreaterThan(0);
    expect(r.muscles.quads.status).toBe("ready");
    expect(r.suggestion).toMatchObject({ kind: "train", workout: "Legs" });
    expect(r.suggestion.reason).toBe("Quads, hamstrings and glutes are recovered — last trained 6 days ago.");
  });

  it("recommends recovery after strength today", () => {
    const r = computeRecovery([{ label: "Legs", occurredAt: ago(2), durationMinutes: 60 }], now, { workoutTypes: types });
    expect(r.muscles.quads.status).toBe("fatigued");
    expect(r.suggestion).toMatchObject({ kind: "rest", headline: "Strength done today" });
  });

  it("uses the focus the user picked for an imported strength session", () => {
    const r = computeRecovery(
      [
        { label: "Traditional Strength Training", focus: "Pull", occurredAt: ago(10), durationMinutes: 55 },
        { label: "Traditional Strength Training", focus: null, occurredAt: ago(30), durationMinutes: 40 },
      ],
      now,
      { workoutTypes: types },
    );
    expect(r.muscles.back.status).toBe("fatigued");
    expect(r.untagged).toBe(1);
  });

  it("is fully recovered after the window and suggests the most overdue split", () => {
    const r = computeRecovery(
      [
        { label: "Push", occurredAt: ago(9 * 24), durationMinutes: 45 },
        { label: "Pull", occurredAt: ago(4 * 24), durationMinutes: 45 },
        { label: "Legs", occurredAt: ago(4 * 24), durationMinutes: 45 },
      ],
      now,
      { workoutTypes: types },
    );
    expect(Object.values(r.muscles).every((m) => m.status === "ready")).toBe(true);
    expect(r.suggestion.workout).toBe("Push");
  });

  it("asks for a first log instead of inventing a plan", () => {
    const r = computeRecovery([], now, { workoutTypes: types });
    expect(r.suggestion.kind).toBe("start");
    expect(r.muscles.chest.lastTrainedAt).toBeNull();
  });
});
