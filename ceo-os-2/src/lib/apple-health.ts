/**
 * Parses Apple Health workout payloads pushed from the user's iPhone.
 *
 * Accepted shapes (tolerant on purpose; field names beyond start/end vary by exporter):
 *  - Health Auto Export REST automation: { data: { workouts: [ { name, start, end, ... } ] } }
 *    start/end documented as "yyyy-MM-dd HH:mm:ss Z".
 *  - Simple / iOS Shortcut: { workouts: [ { type|name, start, end, energy? } ] } or a single workout object.
 *
 * Duration is computed from start/end, never invented. Anything unparseable is skipped and counted.
 */

export interface ParsedWorkout {
  externalId: string;
  label: string;
  start: Date;
  end: Date;
  durationMinutes: number;
  energyKcal: number | null;
}

export interface ParseResult {
  workouts: ParsedWorkout[];
  skipped: number;
  /** Top-level keys of the first workout object, to help verify exporter formats. Never values. */
  fieldsSeen: string[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Accepts ISO 8601 and "yyyy-MM-dd HH:mm:ss Z" (e.g. "2026-11-09 07:15:00 -0500"). */
export function parseHealthDate(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value > 1e12 ? value : value * 1000);
  if (typeof value !== "string") return null;
  const s = value.trim();
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) {
    const tz = m[3] ? (m[3] === "Z" ? "Z" : m[3].includes(":") ? m[3] : `${m[3].slice(0, 3)}:${m[3].slice(3)}`) : "Z";
    const time = m[2]!;
    const d = new Date(`${m[1]}T${time.length === 5 ? `${time}:00` : time}${tz}`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function energyKcal(w: Obj): number | null {
  for (const key of ["activeEnergyBurned", "totalEnergyBurned", "activeEnergy", "energy", "calories", "totalEnergy"]) {
    const v = w[key];
    if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
    if (isObj(v) && typeof v.qty === "number") {
      const units = String(v.units ?? v.unit ?? "kcal").toLowerCase();
      return Math.round(units.startsWith("kj") ? v.qty / 4.184 : v.qty);
    }
  }
  return null;
}

function cleanLabel(raw: string): string {
  const s = raw.replace(/^HKWorkoutActivityType/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
  const titled = s.replace(/\b([a-z])/g, (c) => c.toUpperCase());
  return titled.slice(0, 60) || "Workout";
}

export function parseWorkoutPayload(body: unknown): ParseResult {
  let list: unknown[] = [];
  if (Array.isArray(body)) list = body;
  else if (isObj(body)) {
    if (isObj(body.data) && Array.isArray(body.data.workouts)) list = body.data.workouts;
    else if (Array.isArray(body.workouts)) list = body.workouts;
    else if (body.start || body.startDate) list = [body];
  }

  const workouts: ParsedWorkout[] = [];
  let skipped = 0;
  for (const item of list.slice(0, 500)) {
    if (!isObj(item)) {
      skipped++;
      continue;
    }
    const start = parseHealthDate(item.start ?? item.startDate);
    const end = parseHealthDate(item.end ?? item.endDate);
    const name = [item.name, item.workoutType, item.workoutActivityType, item.activityType, item.type].find((v) => typeof v === "string" && v.trim()) as string | undefined;
    if (!start || !end || end <= start || !name) {
      skipped++;
      continue;
    }
    const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
    if (minutes < 1 || minutes > 24 * 60) {
      skipped++;
      continue;
    }
    const label = cleanLabel(name);
    const id = [item.id, item.platformId, item.uuid].find((v) => typeof v === "string" && v.trim()) as string | undefined;
    workouts.push({
      externalId: (id?.trim() ?? `${label}|${start.toISOString()}`).slice(0, 200),
      label,
      start,
      end,
      durationMinutes: minutes,
      energyKcal: energyKcal(item),
    });
  }
  const first = list.find(isObj);
  return { workouts, skipped, fieldsSeen: first ? Object.keys(first).slice(0, 40) : [] };
}
