"use client";

import { useState } from "react";
import { Archive, Briefcase, CheckCheck, Dumbbell, PenLine, Plus, Repeat, ShoppingBag } from "lucide-react";
import { archiveGoal, createGoal, updateManualGoal } from "@/server/actions";
import { Sheet, SheetOption, useAction } from "@/components/feedback";
import { buttonClass, cx } from "@/components/ui";

type Metric = "workouts_per_week" | "routine_consistency" | "tasks_completed_per_week" | "revenue" | "depop_profit" | "manual";
type Period = "week" | "month" | "quarter" | "year";
const PERIODS: { value: Period; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];
const PICK_PERIOD = new Set<Metric>(["revenue", "depop_profit"]);
type Area = "business" | "finance" | "fitness" | "personal" | "career";

const TEMPLATES: { metric: Metric; area: Area; title: string; target: string; unit: string | null; period: Period; icon: React.ReactNode; label: string; detail: string }[] = [
  { metric: "revenue", area: "business", title: "Monthly revenue", target: "20000", unit: "$", period: "month", icon: <Briefcase size={18} />, label: "Business revenue", detail: "From completed jobs in Housecall Pro" },
  { metric: "depop_profit", area: "finance", title: "Depop profit", target: "500", unit: "$", period: "month", icon: <ShoppingBag size={18} />, label: "Depop profit", detail: "From the sales you log in Shop" },
  { metric: "workouts_per_week", area: "fitness", title: "Train consistently", target: "4", unit: "workouts", period: "week", icon: <Dumbbell size={18} />, label: "Workouts per week", detail: "From your one-tap workout log" },
  { metric: "routine_consistency", area: "personal", title: "Routine consistency", target: "80", unit: "%", period: "week", icon: <Repeat size={18} />, label: "Routine consistency", detail: "From routine check-offs, last 7 days" },
  { metric: "tasks_completed_per_week", area: "career", title: "Weekly execution", target: "15", unit: "tasks", period: "week", icon: <CheckCheck size={18} />, label: "Tasks completed per week", detail: "From completed tasks" },
  { metric: "manual", area: "personal", title: "", target: "", unit: null, period: "year", icon: <PenLine size={18} />, label: "Custom goal", detail: "You update the number yourself" },
];

export function NewGoalButton() {
  const [open, setOpen] = useState(false);
  const [tpl, setTpl] = useState<(typeof TEMPLATES)[number] | null>(null);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("");
  const [unit, setUnit] = useState("");
  const [period, setPeriod] = useState<Period>("year");
  const { run, pending } = useAction();

  const pick = (t: (typeof TEMPLATES)[number]) => {
    setTpl(t);
    setPeriod(t.period);
    setTitle(t.title);
    setTarget(t.target);
    setUnit(t.unit ?? "");
  };
  const close = () => {
    setOpen(false);
    setTpl(null);
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="-my-2 flex items-center gap-1 py-2 text-[14px] font-medium text-accent active:opacity-60">
        <Plus size={16} /> Add
      </button>
      <Sheet open={open} onClose={close} title={tpl ? "Set your target" : "New goal"}>
        {!tpl ? (
          <div className="-mx-2">
            {TEMPLATES.map((t) => (
              <SheetOption key={t.label} icon={t.icon} label={t.label} detail={t.detail} onClick={() => pick(t)} />
            ))}
          </div>
        ) : (
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await run(() =>
                createGoal({ title, area: tpl.area, metric: tpl.metric, period: PICK_PERIOD.has(tpl.metric) ? period : tpl.period, target: Number(target), unit: unit || null }),
              );
              if (r?.ok) close();
            }}
          >
            <label className="block">
              <span className="mb-1.5 block px-1 text-[13px] text-muted">Name</span>
              <input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Read 12 books" className="h-14 w-full rounded-2xl border border-line bg-surface px-4 outline-none focus:border-accent/60" />
            </label>
            {PICK_PERIOD.has(tpl.metric) && (
              <div role="radiogroup" aria-label="Goal period" className="grid grid-cols-4 gap-1 rounded-full border border-line bg-surface p-1">
                {PERIODS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    role="radio"
                    aria-checked={period === p.value}
                    onClick={() => setPeriod(p.value)}
                    className={cx("h-10 rounded-full text-[14px] font-semibold transition", period === p.value ? "bg-raised text-ink" : "text-muted")}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <label className="block flex-1">
                <span className="mb-1.5 block px-1 text-[13px] text-muted">
                  Target {PICK_PERIOD.has(tpl.metric) ? `per ${period}` : tpl.period === "week" && tpl.metric !== "manual" ? "per week" : ""}
                </span>
                <input
                  required
                  inputMode="decimal"
                  value={target}
                  onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ""))}
                  className="h-14 w-full rounded-2xl border border-line bg-surface px-4 tabular outline-none focus:border-accent/60"
                />
              </label>
              {tpl.metric === "manual" && (
                <label className="block w-32">
                  <span className="mb-1.5 block px-1 text-[13px] text-muted">Unit</span>
                  <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="books" className="h-14 w-full rounded-2xl border border-line bg-surface px-4 outline-none focus:border-accent/60" />
                </label>
              )}
            </div>
            {tpl.metric === "revenue" && (
              <p className="rounded-2xl bg-white/[0.04] p-3 text-[13px] leading-relaxed text-muted">
                Progress comes from the totals of completed jobs in Housecall Pro, counted by job date. If Housecall Pro isn't connected, the goal shows your target only. CEO OS never estimates revenue.
              </p>
            )}
            {tpl.metric === "depop_profit" && (
              <p className="rounded-2xl bg-white/[0.04] p-3 text-[13px] leading-relaxed text-muted">
                Progress is the profit on items you mark sold in Shop during this {period}: sale price minus cost, fees and shipping you paid.
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <button type="button" className={buttonClass("secondary", "lg")} onClick={() => setTpl(null)}>
                Back
              </button>
              <button className={cx(buttonClass("primary", "lg"), "flex-1")} disabled={pending || !title.trim() || !Number(target)}>
                Add goal
              </button>
            </div>
          </form>
        )}
      </Sheet>
    </>
  );
}

export function GoalMenu({ goalId, manual, current, unit }: { goalId: string; manual: boolean; current: number | null; unit: string | null }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current === null ? "" : String(current));
  const { run, pending } = useAction();
  return (
    <>
      <button onClick={() => setOpen(true)} className="-m-2 h-11 rounded-full px-3 text-[14px] font-medium text-muted active:bg-white/5">
        {manual ? "Update" : "Edit"}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={manual ? "Update progress" : "Goal"}>
        {manual && (
          <form
            className="mb-4 flex gap-2"
            onSubmit={async (e) => {
              e.preventDefault();
              const r = await run(() => updateManualGoal(goalId, Number(value)));
              if (r?.ok) setOpen(false);
            }}
          >
            <input
              inputMode="decimal"
              aria-label="Current value"
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ""))}
              placeholder={unit ? `Current ${unit}` : "Current value"}
              className="h-14 flex-1 rounded-2xl border border-line bg-surface px-4 tabular outline-none focus:border-accent/60"
            />
            <button className={buttonClass("primary", "lg")} disabled={pending || value === ""}>
              Save
            </button>
          </form>
        )}
        <div className="-mx-2">
          <SheetOption
            icon={<Archive size={18} />}
            label="Archive goal"
            tone="danger"
            onClick={async () => {
              const r = await run(() => archiveGoal(goalId));
              if (r?.ok) setOpen(false);
            }}
          />
        </div>
      </Sheet>
    </>
  );
}
