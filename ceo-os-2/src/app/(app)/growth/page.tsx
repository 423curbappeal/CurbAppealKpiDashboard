import Link from "next/link";
import { ChevronRight, ClipboardCheck, Target } from "lucide-react";
import { Card, cx, EmptyState, ProgressBar, ProvenanceBadge, Ring, Screen, ScreenHeader, SectionTitle } from "@/components/ui";
import { requireContext } from "@/server/context";
import { loadGrowth } from "@/server/data";
import { GoalMenu, NewGoalButton } from "./goals";

export const metadata = { title: "Growth" };

const AREA_LABEL = { business: "Business", finance: "Finance", fitness: "Fitness", personal: "Personal", career: "Career" } as const;

export default async function GrowthPage() {
  const ctx = await requireContext();
  const g = await loadGrowth(ctx);
  const { metrics: m } = g;
  const workoutPct = g.workoutTarget > 0 ? (m.workoutsThisWeek / g.workoutTarget) * 100 : 0;
  const maxBar = Math.max(1, ...g.weekly.map((w) => Math.max(w.workouts, w.tasks)));

  return (
    <Screen>
      <ScreenHeader eyebrow="This week" title="Growth" />

      <div className="grid grid-cols-3 gap-2">
        <Card className="flex flex-col items-center gap-2 p-4">
          <Ring percent={workoutPct}>
            <span className="text-[16px] font-semibold tabular">{m.workoutsThisWeek}</span>
          </Ring>
          <span className="text-center text-[12px] leading-tight text-muted">
            Workouts
            <br />
            <span className="text-faint">of {g.workoutTarget}</span>
          </span>
        </Card>
        <Card className="flex flex-col items-center gap-2 p-4">
          <Ring percent={m.routineConsistency7d ?? 0}>
            <span className="text-[14px] font-semibold tracking-tight tabular">{m.routineConsistency7d === null ? "—" : `${Math.round(m.routineConsistency7d)}%`}</span>
          </Ring>
          <span className="text-center text-[12px] leading-tight text-muted">
            Routines
            <br />
            <span className="text-faint">last 7 days</span>
          </span>
        </Card>
        <Card className="flex flex-col items-center gap-2 p-4">
          <div className="grid size-14 place-items-center rounded-full bg-white/[0.04] text-[20px] font-semibold tabular">{m.tasksCompletedThisWeek}</div>
          <span className="text-center text-[12px] leading-tight text-muted">
            Tasks done
            <br />
            <span className="text-faint">since Monday</span>
          </span>
        </Card>
      </div>

      <SectionTitle action={<span className="flex items-center gap-3 text-[12px] text-faint"><Legend className="bg-accent" label="Workouts" /><Legend className="bg-white/25" label="Tasks" /></span>}>
        Last 8 weeks
      </SectionTitle>
      <Card className="p-4">
        <div className="flex h-28 items-end gap-2" role="img" aria-label="Weekly workouts and completed tasks for the last 8 weeks">
          {g.weekly.map((w, i) => (
            <div key={w.weekStart} className="flex h-full flex-1 flex-col justify-end gap-1">
              <div className="flex flex-1 items-end justify-center gap-[3px]">
                <div className={cx("w-2 rounded-full bg-accent", i === g.weekly.length - 1 ? "opacity-100" : "opacity-70")} style={{ height: `${(w.workouts / maxBar) * 100}%`, minHeight: w.workouts ? 4 : 0 }} />
                <div className="w-2 rounded-full bg-white/25" style={{ height: `${(w.tasks / maxBar) * 100}%`, minHeight: w.tasks ? 4 : 0 }} />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[11px] text-faint">
          <span>8 wks ago</span>
          <span>This week</span>
        </div>
      </Card>

      <SectionTitle action={<NewGoalButton />}>Goals</SectionTitle>
      {g.goals.length === 0 ? (
        <Card>
          <EmptyState icon={<Target size={20} />} title="No goals yet" body="Pick a goal that tracks itself from activity you already record." />
        </Card>
      ) : (
        <div className="space-y-2">
          {g.goals.map((goal) => (
            <Card key={goal.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium tracking-wide text-faint uppercase">{AREA_LABEL[goal.area]}</p>
                  <p className="mt-0.5 truncate text-[16px] font-semibold">{goal.title}</p>
                </div>
                <GoalMenu goalId={goal.id} manual={goal.metric === "manual"} current={goal.manualCurrent} unit={goal.unit} />
              </div>
              <div className="mt-3">
                <ProgressBar percent={goal.progress.percent} tone={goal.progress.percent !== null && goal.progress.percent >= 100 ? "good" : "accent"} />
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3">
                <span className="text-[14px] text-ink tabular">{goal.progress.display}</span>
                <ProvenanceBadge provenance={goal.progress.provenance} />
              </div>
              <p className="mt-1 text-[12px] text-faint">{goal.progress.sourceLabel}</p>
            </Card>
          ))}
        </div>
      )}

      <Link href="/review" className="mt-8 block">
        <Card className="flex items-center gap-4 p-4 active:bg-raised">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent">
            <ClipboardCheck size={20} />
          </div>
          <div className="flex-1">
            <p className="text-[15px] font-semibold">Weekly review</p>
            <p className="text-[13px] text-muted">Auto-drafted summary and next-week plan</p>
          </div>
          <ChevronRight size={18} className="text-faint" />
        </Card>
      </Link>
    </Screen>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cx("size-2 rounded-full", className)} />
      {label}
    </span>
  );
}
