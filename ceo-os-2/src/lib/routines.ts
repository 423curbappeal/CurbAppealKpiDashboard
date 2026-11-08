import { weekdayOf, type DateString } from "./dates";

export interface RoutineLike {
  id: string;
  title: string;
  cadence: "daily" | "weekdays" | "weekends" | "custom";
  daysOfWeek: number[];
}

export function isRoutineScheduled(routine: RoutineLike, day: DateString): boolean {
  const wd = weekdayOf(day);
  switch (routine.cadence) {
    case "daily":
      return true;
    case "weekdays":
      return wd >= 1 && wd <= 5;
    case "weekends":
      return wd === 0 || wd === 6;
    case "custom":
      return routine.daysOfWeek.includes(wd);
  }
}

export function describeCadence(routine: Pick<RoutineLike, "cadence" | "daysOfWeek">): string {
  if (routine.cadence === "daily") return "Every day";
  if (routine.cadence === "weekdays") return "Weekdays";
  if (routine.cadence === "weekends") return "Weekends";
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return [...routine.daysOfWeek].sort().map((d) => names[d]).join(", ") || "No days selected";
}
