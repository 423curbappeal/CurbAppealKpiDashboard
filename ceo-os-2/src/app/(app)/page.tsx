import Link from "next/link";
import { AlertTriangle, CalendarClock, CalendarPlus, ChevronRight, ClipboardCheck, Info, MapPin, Repeat, Sparkles } from "lucide-react";
import { CalendarAutoSync, RoutineToggles, WorkoutQuickLog } from "@/components/quick";
import { TaskRow } from "@/components/tasks";
import { Card, cx, EmptyState, Screen, SectionTitle, TextLink } from "@/components/ui";
import { CaptureHint } from "./capture-hint";
import { requireContext } from "@/server/context";
import { loadHome } from "@/server/data";

export const metadata = { title: "Home" };

export default async function HomePage() {
  const ctx = await requireContext();
  const home = await loadHome(ctx);
  const { briefing } = home;
  const initials = ctx.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <Screen>
      <CalendarAutoSync needed={home.needsSync} />
      <header className="flex items-start justify-between gap-4 pt-6 pb-5">
        <div className="min-w-0 animate-rise">
          <p className="text-[13px] font-medium tracking-wide text-faint uppercase">{briefing.dateLabel}</p>
          <h1 className="mt-1 font-display text-[30px] leading-[1.1] font-semibold tracking-[-0.02em]">{briefing.greeting}</h1>
        </div>
        <Link href="/you" aria-label="Your profile" className="mt-1 grid size-11 shrink-0 place-items-center rounded-full border border-line-strong bg-raised text-[14px] font-semibold text-muted">
          {initials || "Me"}
        </Link>
      </header>

      {briefing.isEmpty ? (
        <Welcome />
      ) : (
        <>
          {/* Briefing */}
          <Card className="animate-rise p-5">
            <div className="flex items-center gap-2 text-[13px] font-semibold tracking-wide text-accent uppercase">
              <Sparkles size={15} /> Briefing
            </div>
            {briefing.summary.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {briefing.summary.map((line) => (
                  <li key={line} className="text-[16px] leading-relaxed text-ink">
                    {line}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[16px] leading-relaxed text-muted">Nothing pressing right now. A good moment to work on something important.</p>
            )}
            {briefing.alerts.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-line pt-4">
                {briefing.alerts.map((a) => (
                  <li key={a.id} className={cx("flex gap-2.5 text-[14px] leading-snug", a.tone === "warning" ? "text-warn" : "text-muted")}>
                    {a.tone === "warning" ? <AlertTriangle size={16} className="mt-0.5 shrink-0" /> : <Info size={16} className="mt-0.5 shrink-0" />}
                    {a.text}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Top 3 */}
          <SectionTitle action={briefing.openTaskCount > 3 ? <TextLink href="/execute">All {briefing.openTaskCount}</TextLink> : undefined}>Top priorities</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            {home.priorityTasks.length > 0 ? (
              home.priorityTasks.map((t) => <TaskRow key={t.id} task={t} showReason />)
            ) : (
              <EmptyState title="You're clear" body="Nothing due and nothing flagged. Capture anything that comes up with the + button." />
            )}
          </Card>

          {/* Schedule */}
          <SectionTitle action={home.calendar !== "not_connected" && home.calendarSyncedAt ? <span className="text-[12px] text-faint">Google Calendar</span> : undefined}>
            Today's schedule
          </SectionTitle>
          {home.calendar === "not_connected" ? (
            <Link href="/you/connections" className="block">
              <Card className="flex items-center gap-4 p-4 active:bg-raised">
                <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent">
                  <CalendarPlus size={20} />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-semibold">Connect your calendar</p>
                  <p className="text-[13px] text-muted">See appointments here without re-entering them.</p>
                </div>
                <ChevronRight size={18} className="text-faint" />
              </Card>
            </Link>
          ) : (
            <Card className="overflow-hidden">
              {briefing.upcoming.length === 0 ? (
                <EmptyState icon={<CalendarClock size={20} />} title="No more appointments today" />
              ) : (
                <ul className="divide-y divide-line">
                  {briefing.upcoming.slice(0, 5).map((e) => (
                    <li key={e.id} className={cx("flex gap-4 px-4 py-3.5", e.isNext && "bg-accent/[0.06]")}>
                      <span className={cx("w-[68px] shrink-0 pt-0.5 text-[14px] font-semibold tabular", e.isNext ? "text-accent" : "text-muted")}>{e.timeLabel}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[16px] text-ink">{e.title}</span>
                        {e.location && (
                          <span className="mt-0.5 flex items-center gap-1 truncate text-[13px] text-faint">
                            <MapPin size={12} className="shrink-0" />
                            {e.location}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                  {briefing.upcoming.length > 5 && <li className="px-4 py-3 text-[14px] text-muted">+{briefing.upcoming.length - 5} more today</li>}
                </ul>
              )}
            </Card>
          )}
        </>
      )}

      {/* Quick log */}
      <SectionTitle action={<span className="text-[13px] text-faint tabular">{home.workoutsThisWeek}/{ctx.weeklyWorkoutTarget} this week</span>}>Log a workout</SectionTitle>
      <WorkoutQuickLog types={ctx.workoutTypes} loggedToday={home.workoutsToday} />

      {briefing.routinesDue.length > 0 && (
        <>
          <SectionTitle>Routines</SectionTitle>
          <RoutineToggles routines={briefing.routinesDue.map((r) => ({ id: r.id, title: r.title, done: r.done }))} />
        </>
      )}

      {home.reviewDue && (
        <Link href="/review" className="mt-8 block">
          <Card className="flex items-center gap-4 border-accent/25 bg-accent/[0.06] p-4 active:bg-accent/10">
            <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent/15 text-accent">
              <ClipboardCheck size={20} />
            </div>
            <div className="flex-1">
              <p className="text-[15px] font-semibold">Weekly review is ready</p>
              <p className="text-[13px] text-muted">Already drafted from your week. About 10 minutes.</p>
            </div>
            <ChevronRight size={18} className="text-faint" />
          </Card>
        </Link>
      )}
    </Screen>
  );
}

function Welcome() {
  return (
    <Card className="animate-rise p-6">
      <p className="text-[13px] font-semibold tracking-wide text-accent uppercase">Welcome to CEO OS</p>
      <h2 className="mt-2 text-[22px] leading-tight font-semibold tracking-[-0.01em]">Let's make tomorrow morning a two-minute check-in.</h2>
      <p className="mt-2 text-[15px] leading-relaxed text-muted">Your briefing builds itself from what you connect and capture. Nothing is invented — so start with three quick steps.</p>
      <ol className="mt-5 space-y-2">
        <li>
          <Link href="/you/connections" className="flex min-h-14 items-center gap-4 rounded-2xl bg-white/[0.04] px-4 active:bg-white/[0.08]">
            <CalendarPlus size={20} className="text-accent" />
            <span className="flex-1 text-[15px] font-medium">Connect Google Calendar</span>
            <ChevronRight size={18} className="text-faint" />
          </Link>
        </li>
        <li>
          <CaptureHint />
        </li>
        <li>
          <Link href="/you#routines" className="flex min-h-14 items-center gap-4 rounded-2xl bg-white/[0.04] px-4 active:bg-white/[0.08]">
            <Repeat size={20} className="text-accent" />
            <span className="flex-1 text-[15px] font-medium">Add a daily routine</span>
            <ChevronRight size={18} className="text-faint" />
          </Link>
        </li>
      </ol>
    </Card>
  );
}
