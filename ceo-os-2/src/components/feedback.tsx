"use client";

import { haptic } from "@/components/app-shell";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cx } from "./ui";

/* ── Toasts ───────────────────────────────────────────────────────────────── */

interface ToastAction {
  label: string;
  run: () => void | Promise<unknown>;
}
interface Toast {
  id: number;
  text: string;
  tone: "default" | "error";
  action?: ToastAction;
}

const ToastContext = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-1), { ...t, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.action ? 5000 : 2600);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-toast z-50 flex flex-col items-center gap-2 px-4 pb-3" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto flex min-h-12 w-full max-w-[420px] animate-rise items-center gap-3 rounded-2xl border px-4 py-2.5 shadow-2xl shadow-black/50 backdrop-blur-xl",
              t.tone === "error" ? "border-bad/30 bg-[#2a1416] text-bad" : "border-line-strong bg-overlay text-ink",
            )}
            role="status"
          >
            <span className="flex-1 text-[15px] font-medium">{t.text}</span>
            {t.action && (
              <button
                className="-my-2 -mr-2 h-11 rounded-full px-3 text-[15px] font-semibold text-accent active:opacity-60"
                onClick={() => {
                  setToasts((prev) => prev.filter((x) => x.id !== t.id));
                  void t.action!.run();
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ── Action runner: pending state + toast feedback + optional undo ───────── */

type Result = { ok: true; message?: string; data?: unknown } | { ok: false; error: string };

export function useAction() {
  const toast = useToast();
  const [pending, start] = useTransition();
  const run = useCallback(
    <R extends Result>(fn: () => Promise<R>, opts: { undo?: (r: R) => () => Promise<unknown>; success?: string; silent?: boolean } = {}) =>
      new Promise<R | null>((resolve) => {
        start(async () => {
          try {
            const r = await fn();
            if (!r.ok) {
              toast({ text: r.error, tone: "error" });
              haptic("error");
            } else if (!opts.silent) {
              haptic("success");
              const text = opts.success ?? r.message;
              if (text) toast({ text, tone: "default", action: opts.undo ? { label: "Undo", run: opts.undo(r) } : undefined });
            }
            resolve(r);
          } catch (e) {
            // Next.js redirects are thrown; let them propagate.
            if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")) throw e;
            toast({ text: "Couldn't reach CEO OS. Check your connection and try again.", tone: "error" });
            resolve(null);
          }
        });
      }),
    [toast],
  );
  return { run, pending };
}

/* ── Bottom sheet ─────────────────────────────────────────────────────────── */

export function Sheet({ open, onClose, title, children, label }: { open: boolean; onClose: () => void; title?: ReactNode; label?: string; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => {
      const first = panel.current?.querySelector<HTMLElement>("[data-autofocus], input, textarea, button");
      first?.focus({ preventScroll: true });
    }, 30);
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus?.({ preventScroll: true });
    };
  }, [open, onClose]);

  if (!mounted || !open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center" role="dialog" aria-modal="true" aria-label={label ?? (typeof title === "string" ? title : undefined)}>
      <button aria-label="Close" className="absolute inset-0 animate-fade bg-black/60 backdrop-blur-[2px]" onClick={onClose} tabIndex={-1} />
      <div ref={panel} className="relative max-h-[88dvh] w-full max-w-[560px] animate-sheet overflow-y-auto rounded-t-[28px] border-t border-line-strong bg-raised px-5 pt-2 pb-safe shadow-2xl">
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-white/15" aria-hidden />
        {title && (
          <div className="flex items-center justify-between pb-3">
            <h2 className="text-[19px] font-semibold tracking-[-0.01em]">{title}</h2>
            <button onClick={onClose} className="-mr-2 grid size-11 place-items-center rounded-full text-muted active:bg-white/5" aria-label="Close">
              <X size={20} />
            </button>
          </div>
        )}
        <div className="pb-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function SheetOption({ icon, label, detail, onClick, tone, disabled }: { icon: ReactNode; label: string; detail?: string; onClick: () => void; tone?: "danger"; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "flex min-h-14 w-full items-center gap-4 rounded-2xl px-3 text-left transition active:bg-white/[0.06] disabled:opacity-40",
        tone === "danger" ? "text-bad" : "text-ink",
      )}
    >
      <span className={cx("grid size-9 shrink-0 place-items-center rounded-xl", tone === "danger" ? "bg-bad/10" : "bg-white/[0.06] text-muted")}>{icon}</span>
      <span className="flex-1">
        <span className="block text-[16px] font-medium">{label}</span>
        {detail && <span className="block text-[13px] text-faint">{detail}</span>}
      </span>
    </button>
  );
}
