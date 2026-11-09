import Link from "next/link";
import { ChevronLeft, Dumbbell, Flame, Info, Watch } from "lucide-react";
import { BodyLegend, BodyMap } from "@/components/body-map";
import { AppleHealthSetup, FocusPrompt } from "@/components/body";
import { Badge, Card, cx, Screen, ScreenHeader, SectionTitle } from "@/components/ui";
import { MUSCLES } from "@/lib/recovery";
import { requireContext } from "@/server/context";
import { loadBody } from "@/server/data";

export const metadata = { title: "Body" };

function ago(d: Date, now: Date) {
  const h = Math.round((now.getTime() - d.getTime()) / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export default async function BodyPage() {
  const ctx = await requireContext();
  const body = await loadBody(ctx);
  const { report } = body;
  const now = new Date();
  const endpoint = `${process.env.APP_URL ?? ""}/api/ingest/apple-health`;
  const order = { fatigued: 0, recovering: 1, ready: 2 } as const;
  const trained = MUSCLES.map((m) => report.muscles[m]).filter((m) => m.lastTrainedAt);
  const untrained = MUSCLES.map((m) => report.muscles[m]).filter((m) => !m.lastTrainedAt);
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: ctx.timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <Screen>
      <Link href="/you" className="-ml-2 inline-flex h-11 items-center gap-1 pr-3 pt-safe text-[15px] text-accent">
        <ChevronLeft size={20} /> You
      </Link>
      <ScreenHeader eyebrow="Recovery" title="Body" />

      <Card className="p-5">
        <p className="text-[13px] font-semibold tracking-wide text-accent uppercase">Today</p>
        <p className="mt-1 text-[20px] font-semibold tracking-[-0.01em]">{report.suggestion.headline}</p>
        <p className="mt-1 text-[15px] leading-relaxed text-muted">{report.suggestion.reason}</p>
        <div className="mt-5">
          <BodyMap muscles={report.muscles} />
        </div>
        <div className="mt-4">
          <BodyLegend />
        </div>
      </Card>

      {body.untagged.length > 0 && (
        <div className="mt-4">
          <FocusPrompt workouts={body.untagged.map((w) => ({ id: w.id, label: w.label, durationMinutes: w.durationMinutes, whenLabel: ago(w.occurredAt, now) }))} />
        </div>
      )}

      {trained.length > 0 && (
        <>
          <SectionTitle>Muscle groups</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            {[...trained].sort((a, b) => order[a.status] - order[b.status] || a.readiness - b.readiness).map((m) => (
              <div key={m.muscle} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                <span className={cx("size-2.5 shrink-0 rounded-full", m.status === "ready" ? "bg-good" : m.status === "recovering" ? "bg-warn" : "bg-bad")} />
                <span className="flex-1">
                  <span className="block text-[16px]">{m.label}</span>
                  <span className="block text-[13px] text-faint">
                    Last trained {m.daysSinceTrained === 0 ? "today" : m.daysSinceTrained === 1 ? "yesterday" : `${m.daysSinceTrained} days ago`}
                  </span>
                </span>
                <span className="text-right text-[13px] text-muted tabular">{m.status === "ready" ? "Ready" : `~${m.hoursUntilReady} h`}</span>
              </div>
            ))}
          </Card>
          {untrained.length > 0 && <p className="mt-2 px-1 text-[13px] text-faint">Not trained in the last 3 weeks: {untrained.map((m) => m.label).join(", ")}.</p>}
        </>
      )}

      <SectionTitle>Recent workouts</SectionTitle>
      <Card className="divide-y divide-line overflow-hidden">
        {body.recent.length === 0 ? (
          <p className="px-4 py-6 text-center text-[14px] text-muted">No workouts in the last 3 weeks. Log one from Home or connect Apple Health.</p>
        ) : (
          body.recent.map((w) => (
            <div key={w.id} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
              {w.source === "apple_health" ? <Watch size={18} className="shrink-0 text-muted" /> : <Dumbbell size={18} className="shrink-0 text-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px]">
                  {w.focus ? `${w.focus} · ` : ""}
                  {w.label}
                </span>
                <span className="block text-[12px] text-faint">{fmt.format(w.occurredAt)}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[13px] text-muted tabular">
                {w.durationMinutes ? `${w.durationMinutes} min` : null}
                {w.energyKcal ? (
                  <span className="flex items-center gap-0.5">
                    <Flame size={12} />
                    {w.energyKcal}
                  </span>
                ) : null}
              </span>
            </div>
          ))
        )}
      </Card>

      <div id="apple-health" className="scroll-mt-6">
        <SectionTitle action={body.appleHealth.connected ? <Badge tone="good">Connected</Badge> : <Badge>Not connected</Badge>}>Apple Watch / Apple Health</SectionTitle>
        <Card className="p-4">
          <p className="mb-4 text-[14px] leading-relaxed text-muted">
            Apple only lets iPhone apps read Health data, so a small app on your phone forwards your workouts here. Runs, rides and HIIT are classified automatically; for strength sessions you'll get a one-tap “what did you train?”.
          </p>
          {body.appleHealth.lastUsedAt && (
            <p className="mb-4 text-[13px] text-faint">
              Last received {ago(body.appleHealth.lastUsedAt, now)}
              {body.appleHealth.summary?.imported !== undefined ? ` · ${body.appleHealth.summary.imported} new workouts` : ""}
            </p>
          )}
          <AppleHealthSetup connected={body.appleHealth.connected} lastFour={body.appleHealth.lastFour} endpoint={endpoint} />
        </Card>
      </div>

      <p className="mt-6 flex items-start gap-2 px-1 text-[12px] leading-relaxed text-faint">
        <Info size={14} className="mt-0.5 shrink-0" />
        Recovery is an estimate based on typical recovery times (48–72 h) and the workouts you've logged — not medical advice. Listen to your body.
      </p>
    </Screen>
  );
}
