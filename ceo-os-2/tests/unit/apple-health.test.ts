import { describe, expect, it } from "vitest";
import { parseHealthDate, parseWorkoutPayload } from "@/lib/apple-health";

describe("parseHealthDate", () => {
  it("parses the Health Auto Export format and ISO", () => {
    expect(parseHealthDate("2026-11-09 07:15:00 -0500")!.toISOString()).toBe("2026-11-09T12:15:00.000Z");
    expect(parseHealthDate("2026-11-09T07:15:00-05:00")!.toISOString()).toBe("2026-11-09T12:15:00.000Z");
    expect(parseHealthDate("not a date")).toBeNull();
  });
});

describe("parseWorkoutPayload", () => {
  it("reads Health Auto Export's data.workouts envelope", () => {
    const r = parseWorkoutPayload({
      data: {
        workouts: [
          { id: "A1", name: "Traditional Strength Training", start: "2026-11-09 06:00:00 -0500", end: "2026-11-09 06:52:00 -0500", activeEnergyBurned: { qty: 1255, units: "kJ" } },
          { id: "A2", name: "Outdoor Run", start: "2026-11-08 18:00:00 -0500", end: "2026-11-08 18:31:00 -0500", activeEnergyBurned: { qty: 320, units: "kcal" } },
        ],
        metrics: [],
      },
    });
    expect(r.skipped).toBe(0);
    expect(r.workouts[0]).toMatchObject({ externalId: "A1", label: "Traditional Strength Training", durationMinutes: 52, energyKcal: 300 });
    expect(r.workouts[1]).toMatchObject({ label: "Outdoor Run", durationMinutes: 31, energyKcal: 320 });
    expect(r.fieldsSeen).toContain("activeEnergyBurned");
  });

  it("accepts a simple shortcut payload and a single object", () => {
    expect(parseWorkoutPayload({ workouts: [{ type: "HKWorkoutActivityTypeCycling", startDate: "2026-11-09T10:00:00Z", endDate: "2026-11-09T10:45:00Z" }] }).workouts[0]).toMatchObject({
      label: "Cycling",
      durationMinutes: 45,
      externalId: "Cycling|2026-11-09T10:00:00.000Z",
    });
    expect(parseWorkoutPayload({ name: "Walking", start: "2026-11-09T10:00:00Z", end: "2026-11-09T10:20:00Z" }).workouts).toHaveLength(1);
  });

  it("skips malformed items instead of inventing data", () => {
    const r = parseWorkoutPayload({ workouts: [{ name: "Run" }, { name: "Run", start: "2026-11-09T10:00:00Z", end: "2026-11-09T09:00:00Z" }, "junk", { start: "2026-11-09T10:00:00Z", end: "2026-11-09T11:00:00Z" }] });
    expect(r.workouts).toEqual([]);
    expect(r.skipped).toBe(4);
    expect(parseWorkoutPayload(null).workouts).toEqual([]);
  });
});

describe("native HealthKit plugin shape (@capgo/capacitor-health)", () => {
  it("uses platformId, workoutType and totalEnergyBurned", () => {
    const r = parseWorkoutPayload({
      workouts: [{ workoutType: "functionalStrengthTraining", startDate: "2026-11-09T11:00:00.000Z", endDate: "2026-11-09T11:41:00.000Z", duration: 2460, totalEnergyBurned: 288.6, platformId: "HK-UUID-1", sourceName: "Apple Watch" }],
    });
    expect(r.workouts[0]).toMatchObject({ externalId: "HK-UUID-1", label: "Functional Strength Training", durationMinutes: 41, energyKcal: 289 });
  });
});
