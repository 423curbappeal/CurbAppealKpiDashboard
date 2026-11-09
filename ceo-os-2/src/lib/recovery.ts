/**
 * Muscle recovery estimate from logged workouts.
 *
 * Deliberately simple and explainable — an estimate, not medical advice:
 *  - each workout loads muscle groups by a weight (primary ≈ 1, secondary ≈ 0.3–0.7)
 *  - load decays linearly over the group's recovery window (48–72 h; cardio 24 h)
 *  - readiness = 1 − remaining load (summed across recent sessions, capped at 1)
 * Workouts we can't map (e.g. an untagged "Strength" import) contribute nothing
 * rather than a guess.
 */

export const MUSCLES = ["chest", "shoulders", "biceps", "triceps", "back", "core", "glutes", "quads", "hamstrings", "calves"] as const;
export type Muscle = (typeof MUSCLES)[number];

export const MUSCLE_LABEL: Record<Muscle, string> = {
  chest: "Chest",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  back: "Back",
  core: "Core",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  calves: "Calves",
};

const RECOVERY_HOURS: Record<Muscle, number> = {
  chest: 72,
  back: 72,
  quads: 72,
  hamstrings: 72,
  glutes: 72,
  shoulders: 60,
  biceps: 48,
  triceps: 48,
  calves: 48,
  core: 48,
};

type Load = Partial<Record<Muscle, number>>;

const PUSH: Load = { chest: 1, shoulders: 0.7, triceps: 0.7 };
const PULL: Load = { back: 1, biceps: 0.7, shoulders: 0.3 };
const LEGS: Load = { quads: 1, hamstrings: 1, glutes: 1, calves: 0.6, core: 0.3 };
const UPPER: Load = { chest: 0.7, back: 0.7, shoulders: 0.6, biceps: 0.5, triceps: 0.5 };
const FULL: Load = { chest: 0.5, back: 0.5, shoulders: 0.4, biceps: 0.3, triceps: 0.3, core: 0.4, glutes: 0.5, quads: 0.5, hamstrings: 0.5, calves: 0.3 };

/** Ordered: the first matching pattern wins. Labels are matched case-insensitively. */
const RULES: { test: RegExp; load: Load; cardio?: boolean; strength?: boolean }[] = [
  { test: /\bpush\b/, load: PUSH, strength: true },
  { test: /\bpull\b/, load: PULL, strength: true },
  { test: /\b(legs?|lower( body)?)\b/, load: LEGS, strength: true },
  { test: /\bupper( body)?\b/, load: UPPER, strength: true },
  { test: /\bfull[ -]?body\b/, load: FULL, strength: true },
  { test: /\barms?\b/, load: { biceps: 1, triceps: 1, shoulders: 0.3 }, strength: true },
  { test: /\bchest\b/, load: { chest: 1, triceps: 0.5, shoulders: 0.4 }, strength: true },
  { test: /\bback\b/, load: { back: 1, biceps: 0.5 }, strength: true },
  { test: /\bshoulders?\b/, load: { shoulders: 1, triceps: 0.3 }, strength: true },
  { test: /\b(core|abs|core training)\b/, load: { core: 1 }, strength: true },
  { test: /\b(hiit|high intensity|cross ?training|crossfit)\b/, load: { quads: 0.4, glutes: 0.3, core: 0.4, shoulders: 0.2, calves: 0.3 }, cardio: true },
  { test: /\b(run|running|jog|treadmill|track)\b/, load: { quads: 0.4, hamstrings: 0.3, glutes: 0.3, calves: 0.5 }, cardio: true },
  { test: /\b(cycl|bike|biking|spin)\w*/, load: { quads: 0.5, glutes: 0.3, calves: 0.2 }, cardio: true },
  { test: /\b(hike|hiking|stair|stepper)\w*/, load: { quads: 0.4, glutes: 0.3, calves: 0.4 }, cardio: true },
  { test: /\b(row|rowing|rower)\b/, load: { back: 0.5, quads: 0.3, biceps: 0.2 }, cardio: true },
  { test: /\b(swim|swimming)\b/, load: { back: 0.4, shoulders: 0.5 }, cardio: true },
  { test: /\b(walk|walking)\b/, load: { calves: 0.2 }, cardio: true },
  { test: /\b(cardio|elliptical)\b/, load: { quads: 0.2, calves: 0.2 }, cardio: true },
];

export interface WorkoutLike {
  label: string;
  /** The muscles the user said they trained (for imported strength sessions). */
  focus?: string | null;
  occurredAt: Date;
  durationMinutes: number | null;
}

export interface Classification {
  load: Load;
  cardio: boolean;
  strength: boolean;
  known: boolean;
}

export function classifyWorkout(label: string): Classification {
  const l = label.toLowerCase();
  if (/\b(yoga|stretch|mobility|pilates|mind|cooldown|cool down|breath)\w*/.test(l)) return { load: {}, cardio: false, strength: false, known: true };
  for (const r of RULES) if (r.test.test(l)) return { load: r.load, cardio: Boolean(r.cardio), strength: Boolean(r.strength), known: true };
  return { load: {}, cardio: false, strength: false, known: false };
}

/** A strength session imported without knowing which muscles were worked. */
export function needsFocus(w: Pick<WorkoutLike, "label" | "focus">): boolean {
  if (w.focus) return false;
  return /strength|weight|resistance/i.test(w.label) && !classifyWorkout(w.label).strength;
}

export type MuscleStatus = "ready" | "recovering" | "fatigued";

export interface MuscleState {
  muscle: Muscle;
  label: string;
  readiness: number; // 0–1
  status: MuscleStatus;
  hoursUntilReady: number;
  lastTrainedAt: Date | null;
  daysSinceTrained: number | null;
}

export interface Suggestion {
  kind: "train" | "rest" | "start";
  workout: string | null;
  headline: string;
  reason: string;
}

export interface RecoveryReport {
  muscles: Record<Muscle, MuscleState>;
  suggestion: Suggestion;
  untagged: number;
}

function durationFactor(minutes: number | null): number {
  if (minutes === null || !Number.isFinite(minutes)) return 1;
  return Math.max(0.5, Math.min(1.3, minutes / 45));
}

function list(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function computeRecovery(workouts: WorkoutLike[], now: Date, options: { workoutTypes: string[] }): RecoveryReport {
  const fatigue = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
  const last = Object.fromEntries(MUSCLES.map((m) => [m, null])) as Record<Muscle, Date | null>;
  const ready = Object.fromEntries(MUSCLES.map((m) => [m, 0])) as Record<Muscle, number>;
  let untagged = 0;

  for (const w of workouts) {
    if (w.occurredAt > now) continue;
    if (needsFocus(w)) {
      untagged++;
      continue;
    }
    const c = classifyWorkout(w.focus || w.label);
    const hours = (now.getTime() - w.occurredAt.getTime()) / 3_600_000;
    const factor = durationFactor(w.durationMinutes);
    for (const [m, weight] of Object.entries(c.load) as [Muscle, number][]) {
      if (weight >= 0.3 && (!last[m] || w.occurredAt > last[m]!)) last[m] = w.occurredAt;
      const window = RECOVERY_HOURS[m];
      const remaining = Math.max(0, 1 - hours / window);
      if (remaining <= 0) continue;
      const load = Math.min(1, weight * factor);
      fatigue[m] = Math.min(1, fatigue[m] + load * remaining);
      ready[m] = Math.max(ready[m], window * (1 - 0.15 / load) - hours); // hours until remaining load < 15%
    }
  }

  const muscles = Object.fromEntries(
    MUSCLES.map((m) => {
      const readiness = Math.round((1 - fatigue[m]) * 100) / 100;
      const status: MuscleStatus = readiness < 0.45 ? "fatigued" : readiness < 0.85 ? "recovering" : "ready";
      const lastTrainedAt = last[m];
      return [
        m,
        {
          muscle: m,
          label: MUSCLE_LABEL[m],
          readiness,
          status,
          hoursUntilReady: status === "ready" ? 0 : Math.max(1, Math.ceil(ready[m])),
          lastTrainedAt,
          daysSinceTrained: lastTrainedAt ? Math.floor((now.getTime() - lastTrainedAt.getTime()) / 86_400_000) : null,
        } satisfies MuscleState,
      ];
    }),
  ) as Record<Muscle, MuscleState>;

  return { muscles, suggestion: suggest(muscles, workouts, now, options.workoutTypes), untagged };
}

function suggest(muscles: Record<Muscle, MuscleState>, workouts: WorkoutLike[], now: Date, types: string[]): Suggestion {
  const anyHistory = workouts.some((w) => !needsFocus(w) && classifyWorkout(w.focus || w.label).known);
  const candidates = types
    .map((t) => ({ type: t, c: classifyWorkout(t) }))
    .filter((x) => x.c.strength || x.c.cardio);

  if (!anyHistory) {
    const first = candidates.find((x) => x.c.strength)?.type ?? types[0] ?? null;
    return {
      kind: "start",
      workout: first,
      headline: first ? `Start with ${first}` : "Log your first workout",
      reason: "Log a few sessions and CEO OS will track what's recovered and what's due.",
    };
  }

  const strengthToday = workouts.some((w) => {
    const c = classifyWorkout(w.focus || w.label);
    return c.strength && now.getTime() - w.occurredAt.getTime() < 12 * 3_600_000 && w.occurredAt <= now;
  });

  let best: { type: string; score: number; primary: MuscleState[] } | null = null;
  for (const { type, c } of candidates.filter((x) => x.c.strength)) {
    const primary = (Object.entries(c.load) as [Muscle, number][]).filter(([, w]) => w >= 0.7).map(([m]) => muscles[m]);
    if (primary.length === 0 || primary.some((p) => p.readiness < 0.85)) continue;
    const avgReady = primary.reduce((s, p) => s + p.readiness, 0) / primary.length;
    const staleness = Math.min(...primary.map((p) => (p.daysSinceTrained === null ? 10 : Math.min(10, p.daysSinceTrained))));
    const score = avgReady * (1 + staleness / 5);
    if (!best || score > best.score) best = { type, score, primary };
  }

  const fatigued = Object.values(muscles).filter((m) => m.status !== "ready").sort((a, b) => a.readiness - b.readiness);

  if (strengthToday) {
    return {
      kind: "rest",
      workout: null,
      headline: "Strength done today",
      reason: fatigued.length ? `${list(fatigued.slice(0, 3).map((m) => m.label))} ${fatigued.length === 1 ? "is" : "are"} recovering. Light cardio or mobility only.` : "Recover well — light cardio or mobility if anything.",
    };
  }
  if (best) {
    const names = best.primary.map((p) => p.label.toLowerCase());
    const days = Math.min(...best.primary.map((p) => p.daysSinceTrained ?? Infinity));
    const when = days === Infinity ? "not trained recently" : days === 0 ? "trained earlier today" : `last trained ${days} day${days === 1 ? "" : "s"} ago`;
    return { kind: "train", workout: best.type, headline: `${best.type} today`, reason: `${capitalize(list(names))} ${names.length === 1 ? "is" : "are"} recovered — ${when}.` };
  }
  const cardio = candidates.find((x) => x.c.cardio)?.type ?? null;
  const soonest = fatigued.sort((a, b) => a.hoursUntilReady - b.hoursUntilReady)[0];
  return {
    kind: "rest",
    workout: cardio,
    headline: cardio ? `Recovery day · ${cardio} optional` : "Recovery day",
    reason: soonest ? `Most muscle groups are still recovering. ${soonest.label} should be ready in about ${soonest.hoursUntilReady} h.` : "Everything is still recovering.",
  };
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
