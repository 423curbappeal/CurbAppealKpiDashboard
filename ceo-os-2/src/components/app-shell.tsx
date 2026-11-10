"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, RefreshCw, Share, SquarePlus } from "lucide-react";
import { Card, buttonClass } from "@/components/ui";

/* ── Haptics ─────────────────────────────────────────────────────────────────
 * Short vibrations where the platform supports them (Android, installed or in
 * the browser). iOS Safari has no vibration API, so this quietly does nothing
 * there. Respects reduced-motion as a proxy for "fewer sensations".
 */
type HapticKind = "tap" | "success" | "error";
const PATTERNS: Record<HapticKind, number | number[]> = { tap: 8, success: [12, 40, 18], error: [30, 50, 30] };

export function haptic(kind: HapticKind = "tap") {
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    navigator.vibrate(PATTERNS[kind]);
  } catch {
    // Not supported: no-op.
  }
}

/* ── Pull to refresh ─────────────────────────────────────────────────────────
 * Installed web apps have no browser reload button, so pulling down at the top
 * of any screen refetches its data (router.refresh keeps scroll and state).
 */
const THRESHOLD = 72;

export function PullToRefresh() {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, start] = useTransition();
  const startY = useRef<number | null>(null);
  const armed = useRef(false);

  useEffect(() => {
    const atTop = () => window.scrollY <= 0;
    const blocked = (t: EventTarget | null) => t instanceof Element && Boolean(t.closest('[role="dialog"], input, textarea, select, [data-no-pull]'));
    const onStart = (e: TouchEvent) => {
      startY.current = atTop() && !blocked(e.target) && e.touches.length === 1 ? e.touches[0]!.clientY : null;
      armed.current = false;
    };
    const onMove = (e: TouchEvent) => {
      if (startY.current === null) return;
      const dy = e.touches[0]!.clientY - startY.current;
      if (dy <= 0 || !atTop()) {
        setPull(0);
        return;
      }
      const eased = Math.min(120, dy * 0.5);
      if (eased >= THRESHOLD && !armed.current) {
        armed.current = true;
        haptic("tap");
      } else if (eased < THRESHOLD) armed.current = false;
      setPull(eased);
    };
    const onEnd = () => {
      if (startY.current !== null && armed.current) start(() => router.refresh());
      startY.current = null;
      armed.current = false;
      setPull(0);
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [router]);

  const visible = pull > 8 || refreshing;
  const offset = refreshing ? 56 : pull;
  return (
    <div
      aria-hidden={!refreshing}
      role="status"
      aria-label={refreshing ? "Refreshing" : undefined}
      className="pointer-events-none fixed inset-x-0 top-0 z-30 flex justify-center pt-safe"
      style={{ transform: `translateY(${offset - 44}px)`, opacity: visible ? 1 : 0, transition: pull ? "none" : "transform 240ms var(--ease-out-soft), opacity 200ms" }}
    >
      <span className="mt-2 grid size-9 place-items-center rounded-full border border-line-strong bg-raised text-accent shadow-lg">
        <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }} />
      </span>
    </div>
  );
}

/* ── Service worker (offline screen + faster repeat loads) ──────────────── */

export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Unsupported or blocked: the app works the same without it.
    });
  }, []);
  return null;
}

/* ── Install help ────────────────────────────────────────────────────────── */

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallCard() {
  const [mode, setMode] = useState<"hidden" | "ios" | "prompt" | "other">("hidden");
  const deferred = useRef<InstallPromptEvent | null>(null);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return;
    const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    setMode(ios ? "ios" : "other");
    const onPrompt = (e: Event) => {
      e.preventDefault();
      deferred.current = e as InstallPromptEvent;
      setMode("prompt");
    };
    const onInstalled = () => setMode("hidden");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (mode === "hidden") return null;
  return (
    <Card className="mt-2 p-4">
      <div className="flex items-start gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent/12 text-accent">
          <Download size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold">Put CEO OS on your home screen</p>
          {mode === "ios" ? (
            <p className="mt-1 text-[13px] leading-relaxed text-muted">
              In Safari, tap <Share size={13} className="inline -translate-y-px" aria-label="Share" /> Share, then{" "}
              <SquarePlus size={13} className="inline -translate-y-px" aria-hidden /> Add to Home Screen. It opens full screen like an app.
            </p>
          ) : mode === "prompt" ? (
            <p className="mt-1 text-[13px] text-muted">Opens full screen, with shortcuts when you long-press the icon.</p>
          ) : (
            <p className="mt-1 text-[13px] leading-relaxed text-muted">Open your browser menu and choose Install app or Add to Home Screen.</p>
          )}
          {mode === "prompt" && (
            <button
              className={`${buttonClass("primary", "sm")} mt-3`}
              onClick={async () => {
                const e = deferred.current;
                if (!e) return;
                await e.prompt();
                const choice = await e.userChoice;
                if (choice.outcome === "accepted") setMode("hidden");
              }}
            >
              Install
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
