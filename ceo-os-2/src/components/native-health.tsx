"use client";

import { useEffect, useRef, useState } from "react";
import { Watch } from "lucide-react";
import { importHealthKitWorkouts } from "@/server/actions";
import { useAction, useToast } from "./feedback";
import { buttonClass, cx } from "./ui";

/**
 * Direct Apple Health access inside the native iPhone app (Capacitor + @capgo/capacitor-health).
 * Workouts are read on-device and sent to CEO OS over the user's signed-in session.
 * In a normal browser these components render nothing / the fallback.
 */

const ENABLED_KEY = "ceo.healthkit.enabled";
const LAST_SYNC_KEY = "ceo.healthkit.lastSync";
const MIN_INTERVAL_MS = 15 * 60_000;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export async function isNativeIOS(): Promise<boolean> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  } catch {
    return false;
  }
}

async function readWorkouts(days: number) {
  const { Health } = await import("@capgo/capacitor-health");
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const all: unknown[] = [];
  let anchor: string | undefined;
  for (let page = 0; page < 5; page++) {
    const res = await Health.queryWorkouts({ startDate: start.toISOString(), endDate: end.toISOString(), limit: 100, anchor });
    all.push(...res.workouts);
    anchor = res.anchor ?? undefined;
    if (!anchor) break;
  }
  return all;
}

async function sync(days: number) {
  const workouts = await readWorkouts(days);
  const r = await importHealthKitWorkouts(workouts);
  storage()?.setItem(LAST_SYNC_KEY, String(Date.now()));
  return r;
}

/** Mounted once in the app shell: quietly pulls new workouts when the app opens. */
export function HealthKitAutoSync() {
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void (async () => {
      const s = storage();
      if (!s || s.getItem(ENABLED_KEY) !== "1") return;
      const last = Number(s.getItem(LAST_SYNC_KEY) ?? 0);
      if (Date.now() - last < MIN_INTERVAL_MS) return;
      if (!(await isNativeIOS())) return;
      try {
        await sync(14);
      } catch {
        /* permission revoked or Health unavailable — the Body page shows the state */
      }
    })();
  }, []);
  return null;
}

/** On the Body page: direct connection when running as the iPhone app, otherwise the given fallback. */
export function HealthKitConnect({ fallback }: { fallback: React.ReactNode }) {
  const [native, setNative] = useState<boolean | null>(null);
  const [enabled, setEnabled] = useState(false);
  const { run, pending } = useAction();
  const toast = useToast();

  useEffect(() => {
    void isNativeIOS().then(setNative);
    setEnabled(storage()?.getItem(ENABLED_KEY) === "1");
  }, []);

  if (native === null) return null;
  if (!native) return <>{fallback}</>;

  const connect = async () => {
    try {
      const { Health } = await import("@capgo/capacitor-health");
      const available = await Health.isAvailable();
      if (!available.available) {
        toast({ text: "Apple Health isn't available on this device.", tone: "error" });
        return;
      }
      await Health.requestAuthorization({ read: ["workouts"] });
      storage()?.setItem(ENABLED_KEY, "1");
      setEnabled(true);
      await run(() => sync(60), { success: undefined });
    } catch {
      toast({ text: "Couldn't read Apple Health. Check Settings → Health → Data Access → CEO OS.", tone: "error" });
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-[14px] leading-relaxed text-muted">
        {enabled
          ? "Connected. New workouts from your Apple Watch sync each time you open CEO OS."
          : "Read your Apple Watch workouts directly. CEO OS only reads workouts — it never writes to Apple Health."}
      </p>
      <button disabled={pending} onClick={connect} className={cx(buttonClass(enabled ? "secondary" : "primary", "md"), "w-full")}>
        <Watch size={18} /> {enabled ? "Sync now" : "Connect Apple Health"}
      </button>
      {enabled && <p className="text-[12px] text-faint">To stop access: iPhone Settings → Health → Data Access & Devices → CEO OS.</p>}
    </div>
  );
}
