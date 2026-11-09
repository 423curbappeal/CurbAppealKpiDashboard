"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, Dumbbell, House, ListChecks, Sprout, UserRound } from "lucide-react";
import { adoptDeviceTimezone, deleteActivity, logWorkout, syncStaleSources, toggleRoutine } from "@/server/actions";
import { useAction, useToast } from "./feedback";
import { cx } from "./ui";

/* ── Workout one-tap logger ───────────────────────────────────────────────── */

export function WorkoutQuickLog({ types, loggedToday, suggested }: { types: string[]; loggedToday: { id: string; label: string }[]; suggested?: string | null }) {
  const { run, pending } = useAction();
  const toast = useToast();
  const [justLogged, setJustLogged] = useState<string | null>(null);
  const counts = new Map<string, number>();
  for (const w of loggedToday) counts.set(w.label, (counts.get(w.label) ?? 0) + 1);

  const log = async (label: string, force = false) => {
    const r = await run(() => logWorkout(label, { force }), { silent: true });
    if (!r?.ok) return;
    const data = r.data as { activityId: string; duplicate?: boolean };
    if (data.duplicate) {
      toast({ text: `${label} already logged in the last 30 min`, tone: "default", action: { label: "Log again", run: () => log(label, true) } });
      return;
    }
    setJustLogged(label);
    setTimeout(() => setJustLogged(null), 1200);
    toast({ text: `${label} logged`, tone: "default", action: { label: "Undo", run: () => deleteActivity(data.activityId) } });
  };

  return (
    <div className="grid grid-cols-4 gap-2">
      {types.map((t) => {
        const n = counts.get(t) ?? 0;
        return (
          <button
            key={t}
            disabled={pending}
            onClick={() => log(t)}
            aria-label={`Log ${t} workout${n ? `, ${n} logged today` : ""}`}
            className={cx(
              "relative flex h-[76px] flex-col items-center justify-center gap-1.5 rounded-2xl border text-[14px] font-medium transition active:scale-95",
              n > 0 ? "border-good/30 bg-good/[0.08] text-good" : t === suggested ? "border-accent/50 bg-accent/[0.08] text-ink" : "border-line bg-surface text-ink",
            )}
          >
            {t === suggested && n === 0 && <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent" aria-label="Suggested" />}
            {justLogged === t || n > 0 ? <Check size={20} className={cx(justLogged === t && "animate-pop")} /> : <Dumbbell size={20} className="text-muted" />}
            <span className="truncate px-1">{t}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Routine toggles ──────────────────────────────────────────────────────── */

export function RoutineToggles({ routines }: { routines: { id: string; title: string; done: boolean }[] }) {
  const { run } = useAction();
  const [state, setState] = useState(() => new Map(routines.map((r) => [r.id, r.done])));
  useEffect(() => setState(new Map(routines.map((r) => [r.id, r.done]))), [routines]);

  return (
    <div className="flex flex-wrap gap-2">
      {routines.map((r) => {
        const done = state.get(r.id) ?? false;
        return (
          <button
            key={r.id}
            role="checkbox"
            aria-checked={done}
            onClick={async () => {
              setState((m) => new Map(m).set(r.id, !done));
              const res = await run(() => toggleRoutine(r.id), { silent: true });
              if (!res?.ok) setState((m) => new Map(m).set(r.id, done));
            }}
            className={cx(
              "flex h-11 items-center gap-2 rounded-full border pr-4 pl-1.5 text-[15px] font-medium transition active:scale-95",
              done ? "border-good/30 bg-good/[0.1] text-good" : "border-line bg-surface text-ink",
            )}
          >
            <span className={cx("grid size-8 place-items-center rounded-full transition", done ? "bg-good text-bg" : "bg-white/[0.06] text-faint")}>
              <Check size={16} strokeWidth={done ? 3 : 2} />
            </span>
            {r.title}
          </button>
        );
      })}
    </div>
  );
}

/* ── Tab bar ──────────────────────────────────────────────────────────────── */

const TABS = [
  { href: "/", label: "Home", icon: House },
  { href: "/execute", label: "Execute", icon: ListChecks },
  { href: "/growth", label: "Growth", icon: Sprout },
  { href: "/you", label: "You", icon: UserRound },
];

export function TabBar() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/80 pb-safe backdrop-blur-2xl backdrop-saturate-150">
      <ul className="mx-auto grid h-[4.75rem] max-w-[560px] grid-cols-4">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href) || (href === "/growth" && path.startsWith("/review"));
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cx("flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", active ? "text-ink" : "text-faint")}
              >
                <Icon size={24} strokeWidth={active ? 2.2 : 1.8} className={cx(active && "text-accent")} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ── Background helpers ───────────────────────────────────────────────────── */

export function TimezoneAdopter({ needed }: { needed: boolean }) {
  const done = useRef(false);
  useEffect(() => {
    if (!needed || done.current) return;
    done.current = true;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) void adoptDeviceTimezone(tz);
  }, [needed]);
  return null;
}

/** Refreshes stale connected sources once per visit, without blocking the screen. */
export function AutoSync({ needed }: { needed: boolean }) {
  const done = useRef(false);
  useEffect(() => {
    if (!needed || done.current) return;
    done.current = true;
    void syncStaleSources().catch(() => {});
  }, [needed]);
  return null;
}
