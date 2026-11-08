"use client";

import { useState } from "react";
import { CalendarClock, Check, CircleDashed, Dumbbell, Lightbulb, Repeat, Trophy } from "lucide-react";
import { approveReview } from "@/server/actions";
import type { WeeklySummary } from "@/lib/review";
import { useAction } from "@/components/feedback";
import { Badge, buttonClass, Card, cx, ProgressBar, ProvenanceBadge, SectionTitle } from "@/components/ui";

type Decision = "carry" | "drop" | "keep";

const fmtRange = (a: string, b: string) => {
  const f = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));
  return `${f(a)} – ${f(b)}`;
};

export function ReviewFlow({ summary, approvedAt, reflection: initialReflection }: { summary: WeeklySummary; approvedAt: string | null; reflection: string }) {
  const { run, pending } = useAction();
  const [reflection, setReflection] = useState(initialReflection);
  const [approved, setApproved] = useState(approvedAt !== null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() =>
    Object.fromEntries(summary.suggestions.map((s) => [s.taskId, s.type === "carry_forward" ? "carry" : "keep"])),
  );

  const submit = async () => {
    const carryForward = Object.entries(decisions).filter(([, d]) => d === "carry").map(([id]) => id);
    const drop = Object.entries(decisions).filter(([, d]) => d === "drop").map(([id]) => id);
    const r = await run(() => approveReview({ carryForward, drop, reflection }));
    if (r?.ok) setApproved(true);
  };

  return (
    <div className="animate-rise">
      <header className="pt-4 pb-5">
        <p className="text-[13px] font-medium tracking-wide text-faint uppercase">{fmtRange(summary.weekStart, summary.weekEnd)}</p>
        <h1 className="mt-1 font-display text-[30px] leading-[1.1] font-semibold tracking-[-0.02em]">Weekly review</h1>
        <p className="mt-2 text-[16px] text-muted">{summary.headline}</p>
        {approved && <Badge tone="good">Reviewed</Badge>}
      </header>

      <SectionTitle>
        <span className="flex items-center gap-2">
          <Trophy size={17} className="text-warn" /> Wins
        </span>
      </SectionTitle>
      <Card className="p-4">
        {summary.completedHighlights.length === 0 ? (
          <p className="text-[15px] text-muted">No completed tasks recorded this week.</p>
        ) : (
          <ul className="space-y-2.5">
            {summary.completedHighlights.map((t, i) => (
              <li key={i} className="flex gap-3 text-[15px]">
                <Check size={18} className="mt-0.5 shrink-0 text-good" />
                {t}
              </li>
            ))}
            {summary.completedCount > summary.completedHighlights.length && <li className="pl-8 text-[14px] text-faint">+{summary.completedCount - summary.completedHighlights.length} more</li>}
          </ul>
        )}
      </Card>

      <SectionTitle>Habits</SectionTitle>
      <div className="grid grid-cols-3 gap-2">
        <Stat icon={<Dumbbell size={17} />} label="Workouts" value={summary.habits.workoutTarget > 0 ? `${summary.habits.workouts}/${summary.habits.workoutTarget}` : String(summary.habits.workouts)} />
        <Stat icon={<Repeat size={17} />} label="Routines" value={summary.habits.routineConsistency === null ? "—" : `${Math.round(summary.habits.routineConsistency)}%`} />
        <Stat icon={<CalendarClock size={17} />} label="Meetings" value={summary.meetings === null ? "—" : String(summary.meetings)} hint={summary.meetings === null ? "No calendar" : undefined} />
      </div>

      {summary.suggestions.length > 0 && (
        <>
          <SectionTitle>Decide on unfinished work</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            {summary.suggestions.map((s) => {
              const d = decisions[s.taskId];
              const options: { v: Decision; label: string }[] =
                s.type === "carry_forward"
                  ? [
                      { v: "carry", label: "Monday" },
                      { v: "keep", label: "Leave" },
                      { v: "drop", label: "Drop" },
                    ]
                  : [
                      { v: "keep", label: "Keep" },
                      { v: "drop", label: "Drop" },
                    ];
              return (
                <div key={s.id} className="px-4 py-3">
                  <p className="flex items-start gap-2 text-[15px]">
                    <CircleDashed size={17} className="mt-0.5 shrink-0 text-faint" />
                    {s.title}
                  </p>
                  <p className="mt-0.5 pl-[25px] text-[13px] text-faint">{s.label}</p>
                  <div className="mt-2.5 flex gap-1 pl-[25px]" role="radiogroup" aria-label={`Decision for ${s.title}`}>
                    {options.map((o) => (
                      <button
                        key={o.v}
                        role="radio"
                        aria-checked={d === o.v}
                        disabled={approved}
                        onClick={() => setDecisions({ ...decisions, [s.taskId]: o.v })}
                        className={cx(
                          "h-9 rounded-full px-4 text-[14px] font-medium transition disabled:opacity-50",
                          d === o.v ? (o.v === "drop" ? "bg-bad/15 text-bad" : "bg-accent/15 text-accent") : "bg-white/[0.05] text-muted",
                        )}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </Card>
        </>
      )}

      {summary.goals.length > 0 && (
        <>
          <SectionTitle>Goals</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            {summary.goals.map((g) => (
              <div key={g.title} className="px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[15px] font-medium">{g.title}</p>
                  <ProvenanceBadge provenance={g.provenance as "actual" | "user_entered" | "unavailable"} />
                </div>
                <div className="mt-2">
                  <ProgressBar percent={g.percent} />
                </div>
                <p className="mt-1.5 text-[13px] text-muted">{g.display}</p>
              </div>
            ))}
          </Card>
        </>
      )}

      {summary.focusIdeas.length > 0 && (
        <>
          <SectionTitle>
            <span className="flex items-center gap-2">
              <Lightbulb size={17} className="text-accent" /> For next week
            </span>
          </SectionTitle>
          <Card className="p-4">
            <ul className="space-y-2.5">
              {summary.focusIdeas.map((f) => (
                <li key={f} className="text-[15px] leading-relaxed text-ink">
                  {f}
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <SectionTitle>Reflection</SectionTitle>
      <textarea
        value={reflection}
        onChange={(e) => setReflection(e.target.value)}
        disabled={approved}
        rows={3}
        maxLength={4000}
        placeholder="Optional — what worked, what didn't, what you'll change."
        aria-label="Reflection"
        className="w-full resize-none rounded-[var(--radius-card)] border border-line bg-surface p-4 text-[16px] leading-relaxed outline-none placeholder:text-faint focus:border-accent/60 disabled:opacity-60"
      />

      <button onClick={submit} disabled={pending || approved} className={cx(buttonClass("primary", "lg"), "mt-6 w-full")}>
        {approved ? "Week reviewed" : "Approve & plan next week"}
      </button>
      {!approved && summary.suggestions.length > 0 && <p className="mt-2 text-center text-[13px] text-faint">Only the changes you chose above will be applied.</p>}
    </div>
  );
}

function Stat({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <Card className="p-3.5">
      <div className="text-muted">{icon}</div>
      <p className="mt-2 text-[20px] font-semibold tabular">{value}</p>
      <p className="text-[12px] text-faint">{hint ?? label}</p>
    </Card>
  );
}
