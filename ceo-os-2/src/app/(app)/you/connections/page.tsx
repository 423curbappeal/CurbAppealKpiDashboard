import Link from "next/link";
import { Briefcase, CalendarDays, ChevronLeft, Lock } from "lucide-react";
import { Badge, Card, Screen, ScreenHeader, SectionTitle } from "@/components/ui";
import { requireContext } from "@/server/context";
import { loadYou } from "@/server/data";
import { googleConfigured } from "@/server/integrations/google-calendar";
import { CalendarControls, HousecallControls } from "./controls";

export const metadata = { title: "Connections" };

const ERRORS: Record<string, string> = {
  denied: "Google access wasn't granted. Nothing was connected.",
  state: "That sign-in link expired. Please try again.",
  exchange: "Google didn't complete the connection. Please try again.",
  missing_code: "Google didn't complete the connection. Please try again.",
  not_configured: "Google Calendar isn't set up on this server yet.",
};

const ROADMAP = [
  { name: "Microsoft Outlook / 365 Calendar", status: "Next up", detail: "Read-only calendar via Microsoft Graph" },
  { name: "QuickBooks Online", status: "Planned", detail: "Verified revenue and expenses for business goals" },
  { name: "Jobber", status: "Evaluating", detail: "Jobs, quotes and clients for service businesses" },
  { name: "Stripe", status: "Planned", detail: "Payments revenue, read-only" },
];

export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireContext();
  const params = await searchParams;
  const { calendar, housecall } = await loadYou(ctx);
  const configured = googleConfigured();
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: ctx.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <Screen>
      <Link href="/you" className="-ml-2 inline-flex h-11 items-center gap-1 pr-3 pt-safe text-[15px] text-accent">
        <ChevronLeft size={20} /> You
      </Link>
      <ScreenHeader title="Connections" />
      <p className="-mt-2 mb-6 px-1 text-[15px] leading-relaxed text-muted">Connect the tools you already use so CEO OS can organize them — no double entry. Everything starts read-only.</p>

      {params.connected === "google" && <p className="mb-4 rounded-2xl bg-good/10 px-4 py-3 text-[14px] text-good">Google Calendar connected.</p>}
      {params.error && <p className="mb-4 rounded-2xl bg-bad/10 px-4 py-3 text-[14px] text-bad">{ERRORS[params.error] ?? "Something went wrong."}</p>}

      <Card className="p-4">
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/[0.06]">
            <CalendarDays size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[16px] font-semibold">Google Calendar</p>
              {calendar.state === "not_connected" ? (
                <Badge>Not connected</Badge>
              ) : calendar.state === "error" ? (
                <Badge tone="bad">Sync failed</Badge>
              ) : calendar.state === "stale" ? (
                <Badge tone="warn">Out of date</Badge>
              ) : (
                <Badge tone="good">Connected</Badge>
              )}
            </div>
            <p className="mt-0.5 text-[13px] text-muted">
              {calendar.account ? `${calendar.account} · ` : ""}Primary calendar, read-only
            </p>
            {calendar.lastSyncedAt && <p className="mt-0.5 text-[13px] text-faint">Last synced {fmt.format(calendar.lastSyncedAt)}</p>}
            {calendar.state === "error" && calendar.lastError && <p className="mt-1 text-[13px] text-bad">{calendar.lastError}</p>}
          </div>
        </div>
        <div className="mt-4">
          <CalendarControls connected={calendar.state !== "not_connected"} configured={configured} />
        </div>
        <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-faint">
          <Lock size={13} className="mt-0.5 shrink-0" />
          CEO OS can see event titles, times and locations. It can't create, change or delete events. Disconnect any time — tokens are revoked and cached events deleted.
        </p>
      </Card>

      <SectionTitle>Business</SectionTitle>
      <Card className="p-4">
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/[0.06]">
            <Briefcase size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[16px] font-semibold">Housecall Pro</p>
              {!housecall.available || housecall.state === "not_connected" ? (
                <Badge>{housecall.available ? "Paused" : "Not set up"}</Badge>
              ) : housecall.state === "error" ? (
                <Badge tone="bad">Sync failed</Badge>
              ) : (
                <Badge tone="good">Connected</Badge>
              )}
            </div>
            <p className="mt-0.5 text-[13px] text-muted">Open estimates and unscheduled jobs become follow-ups. Scheduled jobs appear on Home.</p>
            {housecall.lastSyncedAt && <p className="mt-0.5 text-[13px] text-faint">Last synced {fmt.format(housecall.lastSyncedAt)}</p>}
            {housecall.state === "error" && housecall.lastError && <p className="mt-1 text-[13px] text-bad">{housecall.lastError}</p>}
          </div>
        </div>
        <div className="mt-4">
          <HousecallControls available={housecall.available} paused={housecall.available && housecall.state === "not_connected"} />
        </div>
        <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-faint">
          <Lock size={13} className="mt-0.5 shrink-0" />
          Read-only. CEO OS never changes anything in Housecall Pro. Follow-ups close automatically when an estimate is approved, declined or expires there.
        </p>
      </Card>

      <SectionTitle>Coming next</SectionTitle>
      <Card className="divide-y divide-line overflow-hidden">
        {ROADMAP.map((r) => (
          <div key={r.name} className="flex min-h-16 items-center gap-4 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-[15px]">{r.name}</p>
              <p className="text-[13px] text-faint">{r.detail}</p>
            </div>
            <Badge tone={r.status === "Next up" ? "accent" : "neutral"}>{r.status}</Badge>
          </div>
        ))}
      </Card>
    </Screen>
  );
}
