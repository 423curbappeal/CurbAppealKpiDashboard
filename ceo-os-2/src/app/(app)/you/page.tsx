import Link from "next/link";
import { Activity, Briefcase, CalendarDays, ChevronRight, ShieldCheck } from "lucide-react";
import { Badge, Card, Screen, ScreenHeader, SectionTitle } from "@/components/ui";
import { describeCadence } from "@/lib/routines";
import { requireContext } from "@/server/context";
import { loadYou } from "@/server/data";
import { AccountActions, RoutineManager, TimezoneSelect, WorkoutSettings } from "./settings";

export const metadata = { title: "You" };

export default async function YouPage() {
  const ctx = await requireContext();
  const you = await loadYou(ctx);
  const cal = you.calendar;

  return (
    <Screen>
      <ScreenHeader eyebrow={ctx.email} title={ctx.name || "You"} />

      <SectionTitle>Fitness</SectionTitle>
      <Link href="/you/body" className="mb-2 block">
        <Card className="flex min-h-16 items-center gap-4 px-4 py-3 active:bg-raised">
          <Activity size={20} className="text-muted" />
          <span className="flex-1">
            <span className="block text-[16px]">Body & recovery</span>
            <span className="block text-[13px] text-faint">Muscle map, what to train, Apple Watch</span>
          </span>
          <ChevronRight size={18} className="text-faint" />
        </Card>
      </Link>
      <Card className="overflow-hidden">
        <WorkoutSettings target={ctx.weeklyWorkoutTarget} types={ctx.workoutTypes} />
      </Card>

      <div id="routines" className="scroll-mt-6">
        <SectionTitle>Routines</SectionTitle>
        <Card className="overflow-hidden">
          <RoutineManager routines={you.routines.map((r) => ({ id: r.id, title: r.title, cadenceLabel: describeCadence(r) }))} />
        </Card>
      </div>

      <SectionTitle>Connected apps</SectionTitle>
      <Link href="/you/connections" className="block">
        <Card className="flex min-h-16 items-center gap-4 px-4 py-3 active:bg-raised">
          <CalendarDays size={20} className="text-muted" />
          <span className="flex-1 text-[16px]">Google Calendar</span>
          {cal.state === "not_connected" ? <Badge>Not connected</Badge> : cal.state === "error" ? <Badge tone="bad">Needs attention</Badge> : <Badge tone="good">Connected</Badge>}
          <ChevronRight size={18} className="text-faint" />
        </Card>
      </Link>
      {you.housecall.available && (
        <Link href="/you/connections" className="mt-2 block">
          <Card className="flex min-h-16 items-center gap-4 px-4 py-3 active:bg-raised">
            <Briefcase size={20} className="text-muted" />
            <span className="flex-1 text-[16px]">Housecall Pro</span>
            {you.housecall.state === "not_connected" ? <Badge>Paused</Badge> : you.housecall.state === "error" ? <Badge tone="bad">Needs attention</Badge> : <Badge tone="good">Connected</Badge>}
            <ChevronRight size={18} className="text-faint" />
          </Card>
        </Link>
      )}

      <SectionTitle>Preferences</SectionTitle>
      <Card className="overflow-hidden">
        <TimezoneSelect current={ctx.timeZone} />
      </Card>

      <SectionTitle>Privacy & account</SectionTitle>
      <Card className="overflow-hidden">
        <AccountActions email={ctx.email} />
      </Card>
      <p className="mt-4 flex items-start gap-2 px-1 text-[13px] leading-relaxed text-faint">
        <ShieldCheck size={16} className="mt-0.5 shrink-0" />
        Your data is isolated to your account at the database level. Connected-service tokens are encrypted and never sent to your browser.
      </p>
    </Screen>
  );
}
