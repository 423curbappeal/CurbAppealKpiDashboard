"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Briefcase, CalendarDays, Clock, Flag, Mic, Phone, Plus, User } from "lucide-react";
import { createTask, previewCapture } from "@/server/actions";
import type { CaptureResult } from "@/lib/capture";
import { Sheet, useAction, useToast } from "./feedback";
import { buttonClass, cx } from "./ui";

const CaptureContext = createContext<(prefill?: string) => void>(() => {});
export const useCapture = () => useContext(CaptureContext);

const EXAMPLES = ["Call John tomorrow afternoon", "Send the Miller estimate Friday at 10am", "Renew truck insurance in 2 weeks", "Text Sarah tonight"];

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function getRecognition(): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Ctor ? new Ctor() : null;
}

export function CaptureProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState("");
  const openCapture = useCallback((text?: string) => {
    setPrefill(text ?? "");
    setOpen(true);
  }, []);
  return (
    <CaptureContext.Provider value={openCapture}>
      {children}
      <Sheet open={open} onClose={() => setOpen(false)} label="Capture">
        <CaptureFlow initial={prefill} onDone={() => setOpen(false)} />
      </Sheet>
    </CaptureContext.Provider>
  );
}

export function CaptureButton() {
  const open = useCapture();
  return (
    <button
      onClick={() => open()}
      aria-label="Capture a task"
      className="fixed right-5 bottom-tabbar z-30 mb-3 grid size-14 place-items-center rounded-full bg-accent text-accent-ink shadow-[0_10px_30px_-6px_rgb(143_162_255_/_0.55)] transition active:scale-90"
    >
      <Plus size={26} strokeWidth={2.4} />
    </button>
  );
}

function CaptureFlow({ initial, onDone }: { initial: string; onDone: () => void }) {
  const [text, setText] = useState(initial);
  const [draft, setDraft] = useState<CaptureResult | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const { run, pending } = useAction();
  const toast = useToast();
  const example = EXAMPLES[new Date().getMinutes() % EXAMPLES.length];

  useEffect(() => setVoiceSupported(getRecognition() !== null), []);

  const interpret = async (value = text) => {
    if (!value.trim()) return;
    const r = await run(() => previewCapture(value), { silent: true });
    if (r?.ok && r.data) setDraft(r.data);
  };

  const toggleVoice = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const rec = getRecognition();
    if (!rec) return;
    recognition.current = rec;
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    let finalText = "";
    rec.onresult = (e) => {
      finalText = Array.from(e.results)
        .map((r) => r[0]?.transcript ?? "")
        .join(" ");
      setText(finalText);
    };
    rec.onerror = () => {
      setListening(false);
      toast({ text: "Voice capture isn't available right now.", tone: "error" });
    };
    rec.onend = () => {
      setListening(false);
      if (finalText.trim()) void interpret(finalText);
    };
    setListening(true);
    rec.start();
  };

  const save = async () => {
    if (!draft) return;
    const r = await run(() =>
      createTask({
        title: draft.title,
        kind: draft.kind,
        scope: draft.scope,
        priority: draft.priority,
        dueDate: draft.dueDate,
        dueTime: draft.dueDate ? draft.dueTime : null,
        contactName: draft.contactName,
        source: "capture",
      }),
    );
    if (r?.ok) onDone();
  };

  if (!draft) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void interpret();
        }}
        className="pt-2"
      >
        <label htmlFor="capture-input" className="text-[19px] font-semibold tracking-[-0.01em]">
          What's on your mind?
        </label>
        <p className="mt-1 text-[14px] text-muted">Type it the way you'd say it. I'll work out the details.</p>
        <div className="mt-4 flex items-end gap-2 rounded-[22px] border border-line-strong bg-surface p-2 pl-4 focus-within:border-accent/60">
          <textarea
            id="capture-input"
            data-autofocus
            rows={2}
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void interpret();
              }
            }}
            placeholder={`e.g. ${example}`}
            className="max-h-40 min-h-12 flex-1 resize-none bg-transparent py-2.5 text-[17px] leading-snug text-ink outline-none placeholder:text-faint"
          />
          {voiceSupported && (
            <button
              type="button"
              onClick={toggleVoice}
              aria-label={listening ? "Stop dictation" : "Dictate"}
              aria-pressed={listening}
              className={cx("grid size-11 shrink-0 place-items-center rounded-full transition", listening ? "animate-pulse bg-bad/20 text-bad" : "bg-white/[0.06] text-muted")}
            >
              <Mic size={20} />
            </button>
          )}
          <button type="submit" disabled={!text.trim() || pending} aria-label="Interpret" className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-accent-ink transition active:scale-90 disabled:opacity-30">
            <ArrowUp size={22} strokeWidth={2.4} />
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="animate-rise pt-2">
      <p className="text-[13px] font-medium tracking-wide text-faint uppercase">Confirm</p>
      <input
        aria-label="Task title"
        value={draft.title}
        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        className="mt-1 w-full bg-transparent text-[22px] font-semibold tracking-[-0.01em] text-ink outline-none"
      />
      {draft.contactName && (
        <p className="mt-1 flex items-center gap-1.5 text-[14px] text-muted">
          <Phone size={14} /> Follow-up with {draft.contactName}
        </p>
      )}

      <div className="mt-5 grid grid-cols-2 gap-2">
        <label className="flex h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-3">
          <CalendarDays size={18} className="shrink-0 text-muted" />
          <span className="sr-only">Due date</span>
          <input
            type="date"
            value={draft.dueDate ?? ""}
            onChange={(e) => setDraft({ ...draft, dueDate: e.target.value || null })}
            className="w-full min-w-0 bg-transparent text-[15px] text-ink outline-none [color-scheme:dark]"
          />
        </label>
        <label className={cx("flex h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-3", !draft.dueDate && "opacity-40")}>
          <Clock size={18} className="shrink-0 text-muted" />
          <span className="sr-only">Time</span>
          <input
            type="time"
            disabled={!draft.dueDate}
            value={draft.dueTime ?? ""}
            onChange={(e) => setDraft({ ...draft, dueTime: e.target.value || null })}
            className="w-full min-w-0 bg-transparent text-[15px] text-ink outline-none [color-scheme:dark]"
          />
        </label>
        <button
          type="button"
          aria-pressed={draft.priority === "high"}
          onClick={() => setDraft({ ...draft, priority: draft.priority === "high" ? "normal" : "high" })}
          className={cx("flex h-14 items-center gap-3 rounded-2xl border px-3 text-[15px] transition", draft.priority === "high" ? "border-warn/40 bg-warn/10 text-warn" : "border-line bg-surface text-muted")}
        >
          <Flag size={18} /> {draft.priority === "high" ? "High priority" : "Normal"}
        </button>
        <button
          type="button"
          aria-pressed={draft.scope === "business"}
          onClick={() => setDraft({ ...draft, scope: draft.scope === "business" ? "personal" : "business" })}
          className={cx("flex h-14 items-center gap-3 rounded-2xl border px-3 text-[15px] transition", draft.scope === "business" ? "border-business/40 bg-business/10 text-business" : "border-line bg-surface text-muted")}
        >
          {draft.scope === "business" ? <Briefcase size={18} /> : <User size={18} />} {draft.scope === "business" ? "Business" : "Personal"}
        </button>
      </div>

      <div className="mt-6 flex gap-2">
        <button type="button" onClick={() => setDraft(null)} className={buttonClass("secondary", "lg")}>
          Edit text
        </button>
        <button type="button" onClick={save} disabled={pending || !draft.title.trim()} className={cx(buttonClass("primary", "lg"), "flex-1")} data-autofocus>
          Add task
        </button>
      </div>
    </div>
  );
}
