"use client";

import { useState } from "react";
import { Minus, Plus, Trash2, X } from "lucide-react";
import { archiveRoutine, createRoutine, deleteAccount, signOut, updatePreferences } from "@/server/actions";
import { Sheet, useAction } from "@/components/feedback";
import { buttonClass, cx } from "@/components/ui";

export function WorkoutSettings({ target, types }: { target: number; types: string[] }) {
  const { run, pending } = useAction();
  const [list, setList] = useState(types);
  const [draft, setDraft] = useState("");
  const save = (next: string[]) => {
    setList(next);
    void run(() => updatePreferences({ workoutTypes: next }), { success: "Quick log updated" });
  };
  return (
    <div className="divide-y divide-line">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div>
          <p className="text-[16px]">Weekly workout target</p>
          <p className="text-[13px] text-faint">Drives your briefing and Growth</p>
        </div>
        <div className="flex items-center gap-1">
          <button aria-label="Decrease target" disabled={pending || target <= 0} onClick={() => run(() => updatePreferences({ weeklyWorkoutTarget: target - 1 }), { silent: true })} className="grid size-11 place-items-center rounded-full bg-white/[0.06] disabled:opacity-30">
            <Minus size={18} />
          </button>
          <span className="w-8 text-center text-[18px] font-semibold tabular" aria-live="polite">{target}</span>
          <button aria-label="Increase target" disabled={pending || target >= 14} onClick={() => run(() => updatePreferences({ weeklyWorkoutTarget: target + 1 }), { silent: true })} className="grid size-11 place-items-center rounded-full bg-white/[0.06] disabled:opacity-30">
            <Plus size={18} />
          </button>
        </div>
      </div>
      <div className="px-4 py-3">
        <p className="text-[16px]">Quick-log buttons</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {list.map((t) => (
            <span key={t} className="flex h-10 items-center gap-1 rounded-full bg-white/[0.06] pr-1 pl-4 text-[15px]">
              {t}
              <button aria-label={`Remove ${t}`} disabled={list.length <= 1} onClick={() => save(list.filter((x) => x !== t))} className="grid size-8 place-items-center rounded-full text-faint disabled:opacity-30">
                <X size={15} />
              </button>
            </span>
          ))}
          {list.length < 8 && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const v = draft.trim();
                if (v && !list.includes(v)) save([...list, v]);
                setDraft("");
              }}
            >
              <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={20} placeholder="+ Add" aria-label="Add workout type" className="h-10 w-24 rounded-full border border-dashed border-line-strong bg-transparent px-4 text-[15px] outline-none focus:w-36 focus:border-accent/60" />
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

export function RoutineManager({ routines }: { routines: { id: string; title: string; cadenceLabel: string }[] }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [cadence, setCadence] = useState<"daily" | "weekdays" | "weekends" | "custom">("daily");
  const [days, setDays] = useState<number[]>([]);
  const { run, pending } = useAction();
  return (
    <>
      <ul className="divide-y divide-line">
        {routines.map((r) => (
          <li key={r.id} className="flex min-h-14 items-center gap-3 px-4">
            <span className="flex-1">
              <span className="block text-[16px]">{r.title}</span>
              <span className="block text-[13px] text-faint">{r.cadenceLabel}</span>
            </span>
            <button aria-label={`Remove ${r.title}`} onClick={() => run(() => archiveRoutine(r.id))} className="grid size-11 place-items-center rounded-full text-faint active:bg-white/5">
              <Trash2 size={17} />
            </button>
          </li>
        ))}
        <li>
          <button onClick={() => setOpen(true)} className="flex h-14 w-full items-center gap-3 px-4 text-[16px] font-medium text-accent active:bg-white/[0.03]">
            <Plus size={18} /> Add routine
          </button>
        </li>
      </ul>
      <Sheet open={open} onClose={() => setOpen(false)} title="New routine">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => createRoutine({ title, cadence, daysOfWeek: days }));
            if (r?.ok) {
              setOpen(false);
              setTitle("");
              setDays([]);
              setCadence("daily");
            }
          }}
        >
          <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Plan tomorrow, Read 20 min" aria-label="Routine name" className="h-14 w-full rounded-2xl border border-line bg-surface px-4 outline-none focus:border-accent/60" />
          <div className="grid grid-cols-4 gap-1 rounded-2xl bg-surface p-1" role="radiogroup" aria-label="Schedule">
            {(["daily", "weekdays", "weekends", "custom"] as const).map((c) => (
              <button type="button" role="radio" aria-checked={cadence === c} key={c} onClick={() => setCadence(c)} className={cx("h-11 rounded-xl text-[14px] font-medium capitalize transition", cadence === c ? "bg-overlay text-ink" : "text-muted")}>
                {c === "daily" ? "Every day" : c}
              </button>
            ))}
          </div>
          {cadence === "custom" && (
            <div className="flex justify-between">
              {DAYS.map((d, i) => (
                <button
                  type="button"
                  key={i}
                  aria-pressed={days.includes(i)}
                  aria-label={["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][i]}
                  onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i])}
                  className={cx("grid size-11 place-items-center rounded-full text-[15px] font-semibold transition", days.includes(i) ? "bg-accent text-accent-ink" : "bg-white/[0.06] text-muted")}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          <button className={cx(buttonClass("primary", "lg"), "w-full")} disabled={pending || !title.trim()}>
            Add routine
          </button>
        </form>
      </Sheet>
    </>
  );
}

export function TimezoneSelect({ current }: { current: string }) {
  const { run } = useAction();
  const zones = (() => {
    try {
      return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [current];
    } catch {
      return [current];
    }
  })();
  return (
    <label className="flex min-h-14 items-center justify-between gap-4 px-4">
      <span className="text-[16px]">Time zone</span>
      <select
        defaultValue={current}
        onChange={(e) => run(() => updatePreferences({ timezone: e.target.value }), { success: "Time zone updated" })}
        className="max-w-[55%] truncate bg-transparent text-right text-[15px] text-muted outline-none [color-scheme:dark]"
      >
        {(zones.includes(current) ? zones : [current, ...zones]).map((z) => (
          <option key={z} value={z}>
            {z.replace(/_/g, " ")}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AccountActions({ email }: { email: string }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const { run, pending } = useAction();
  return (
    <>
      <div className="divide-y divide-line">
        <a href="/api/export" className="flex h-14 items-center px-4 text-[16px] active:bg-white/[0.03]">
          Export my data <span className="ml-auto text-[13px] text-faint">JSON</span>
        </a>
        <form action={signOut}>
          <button className="flex h-14 w-full items-center px-4 text-[16px] active:bg-white/[0.03]">Sign out</button>
        </form>
        <button onClick={() => setOpen(true)} className="flex h-14 w-full items-center px-4 text-[16px] text-bad active:bg-white/[0.03]">
          Delete account
        </button>
      </div>
      <Sheet open={open} onClose={() => setOpen(false)} title="Delete account">
        <p className="text-[15px] leading-relaxed text-muted">
          This permanently deletes your account, tasks, routines, goals, reviews and connected-service tokens. It can't be undone. Export your data first if you want a copy.
        </p>
        <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={email} aria-label="Type your email to confirm" autoCapitalize="none" autoCorrect="off" className="mt-4 h-14 w-full rounded-2xl border border-line bg-surface px-4 outline-none focus:border-bad/60" />
        <button disabled={pending || confirm.trim().toLowerCase() !== email.toLowerCase()} onClick={() => run(() => deleteAccount(confirm))} className={cx(buttonClass("danger", "lg"), "mt-4 w-full")}>
          Permanently delete
        </button>
      </Sheet>
    </>
  );
}
