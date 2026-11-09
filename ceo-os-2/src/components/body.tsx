"use client";

import { useState } from "react";
import { Check, Copy, Watch } from "lucide-react";
import { createAppleHealthToken, revokeAppleHealthToken, setWorkoutFocus } from "@/server/actions";
import { useAction } from "./feedback";
import { buttonClass, cx } from "./ui";

const FOCUS = ["Push", "Pull", "Legs", "Upper", "Lower", "Full Body"];

/** "Strength · 52 min from Apple Watch — what did you train?" with one-tap answers. */
export function FocusPrompt({ workouts }: { workouts: { id: string; label: string; durationMinutes: number | null; whenLabel: string }[] }) {
  const { run, pending } = useAction();
  const [done, setDone] = useState<Record<string, string>>({});
  const open = workouts.filter((w) => !done[w.id]);
  if (open.length === 0) return null;
  const w = open[0]!;
  return (
    <div className="rounded-2xl border border-accent/25 bg-accent/[0.06] p-4">
      <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
        <Watch size={16} className="text-accent" /> What did you train?
      </p>
      <p className="mt-0.5 text-[13px] text-muted">
        {w.label}
        {w.durationMinutes ? ` · ${w.durationMinutes} min` : ""} · {w.whenLabel} · from Apple Watch
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {FOCUS.map((f) => (
          <button
            key={f}
            disabled={pending}
            onClick={async () => {
              const r = await run(() => setWorkoutFocus(w.id, f));
              if (r?.ok) setDone((d) => ({ ...d, [w.id]: f }));
            }}
            className="h-10 rounded-full border border-line-strong bg-surface px-4 text-[14px] font-medium text-ink transition active:scale-95"
          >
            {f}
          </button>
        ))}
      </div>
      {open.length > 1 && <p className="mt-2 text-[12px] text-faint">{open.length - 1} more to tag</p>}
    </div>
  );
}

export function AppleHealthSetup({ connected, lastFour, endpoint }: { connected: boolean; lastFour: string | null; endpoint: string }) {
  const { run, pending } = useAction();
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<"token" | "url" | null>(null);

  const copy = async (value: string, which: "token" | "url") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* clipboard unavailable; the value is still selectable */
    }
  };

  const field = (label: string, value: string, which: "token" | "url") => (
    <div>
      <p className="mb-1 px-1 text-[12px] text-faint">{label}</p>
      <div className="flex items-center gap-2 rounded-2xl border border-line bg-bg p-2 pl-3">
        <code className="min-w-0 flex-1 truncate text-[13px] text-ink select-all">{value}</code>
        <button onClick={() => copy(value, which)} aria-label={`Copy ${label}`} className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.06] text-muted">
          {copied === which ? <Check size={16} className="text-good" /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {token ? (
        <div className="space-y-3">
          <p className="rounded-2xl bg-warn/10 px-4 py-3 text-[13px] leading-relaxed text-warn">Copy this token now — it's shown only once. Anyone with it can add workouts to your account, so don't share it.</p>
          {field("Web address (URL)", endpoint, "url")}
          {field("Token", token, "token")}
        </div>
      ) : connected ? (
        <p className="text-[14px] text-muted">Sync token ending in ••••{lastFour} is active.</p>
      ) : null}

      <ol className="space-y-2 text-[14px] leading-relaxed text-muted">
        <li>
          <span className="font-semibold text-ink">1.</span> On your iPhone, install <span className="text-ink">Health Auto Export</span> from the App Store and allow it to read Workouts. Automatic sending may require its paid tier.
        </li>
        <li>
          <span className="font-semibold text-ink">2.</span> In the app: <span className="text-ink">Automations → New → REST API</span>. Data type: <span className="text-ink">Workouts</span>. Format: <span className="text-ink">JSON</span>.
        </li>
        <li>
          <span className="font-semibold text-ink">3.</span> Paste the <span className="text-ink">URL</span> above. Add a header: <code className="text-ink">Authorization</code> = <code className="text-ink">Bearer</code> followed by a space and your token.
        </li>
        <li>
          <span className="font-semibold text-ink">4.</span> Turn the automation on and tap <span className="text-ink">Export now</span> once to send your recent workouts.
        </li>
      </ol>

      <div className="flex gap-2">
        <button
          disabled={pending}
          onClick={async () => {
            const r = await run(() => createAppleHealthToken(), { silent: true });
            if (r?.ok && r.data) setToken((r.data as { token: string }).token);
          }}
          className={cx(buttonClass(connected ? "secondary" : "primary", "md"), "flex-1")}
        >
          {connected ? "Create new token" : "Create sync token"}
        </button>
        {connected && (
          <button
            disabled={pending}
            onClick={async () => {
              await run(() => revokeAppleHealthToken());
              setToken(null);
            }}
            className={buttonClass("ghost", "md")}
          >
            Turn off
          </button>
        )}
      </div>
      {connected && !token && <p className="text-[12px] text-faint">Creating a new token stops the old one from working.</p>}
    </div>
  );
}
