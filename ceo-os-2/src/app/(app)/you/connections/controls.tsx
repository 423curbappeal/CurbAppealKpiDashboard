"use client";

import { RefreshCw } from "lucide-react";
import { disconnectCalendar, setHousecall, syncCalendarNow, syncHousecallNow } from "@/server/actions";
import { useAction } from "@/components/feedback";
import { buttonClass, cx } from "@/components/ui";

export function CalendarControls({ connected, configured }: { connected: boolean; configured: boolean }) {
  const { run, pending } = useAction();
  if (!connected) {
    return configured ? (
      <a href="/api/integrations/google/start" className={cx(buttonClass("primary", "md"), "w-full")}>
        Connect Google Calendar
      </a>
    ) : (
      <p className="rounded-2xl bg-white/[0.04] p-3 text-[13px] leading-relaxed text-muted">
        Not available yet: this server has no Google OAuth credentials. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see the deployment guide).
      </p>
    );
  }
  return (
    <div className="flex gap-2">
      <button disabled={pending} onClick={() => run(() => syncCalendarNow())} className={cx(buttonClass("secondary", "md"), "flex-1")}>
        <RefreshCw size={16} className={cx(pending && "animate-spin")} /> Sync now
      </button>
      <button disabled={pending} onClick={() => run(() => disconnectCalendar())} className={buttonClass("ghost", "md")}>
        Disconnect
      </button>
    </div>
  );
}

export function HousecallControls({ available, paused }: { available: boolean; paused: boolean }) {
  const { run, pending } = useAction();
  if (!available) {
    return (
      <p className="rounded-2xl bg-white/[0.04] p-3 text-[13px] leading-relaxed text-muted">
        Requires a Housecall Pro MAX plan API key, set on the server (HOUSECALL_PRO_API_KEY and HOUSECALL_PRO_ACCOUNT_EMAIL). Keys are never entered in the app. See the deployment guide.
      </p>
    );
  }
  if (paused) {
    return (
      <button disabled={pending} onClick={() => run(() => setHousecall(true))} className={cx(buttonClass("primary", "md"), "w-full")}>
        Turn on sync
      </button>
    );
  }
  return (
    <div className="flex gap-2">
      <button disabled={pending} onClick={() => run(() => syncHousecallNow())} className={cx(buttonClass("secondary", "md"), "flex-1")}>
        <RefreshCw size={16} className={cx(pending && "animate-spin")} /> Sync now
      </button>
      <button disabled={pending} onClick={() => run(() => setHousecall(false))} className={buttonClass("ghost", "md")}>
        Pause
      </button>
    </div>
  );
}
