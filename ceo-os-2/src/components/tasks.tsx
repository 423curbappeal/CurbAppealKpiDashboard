"use client";

import { useState } from "react";
import { AlarmClock, Briefcase, CalendarArrowUp, CalendarDays, Check, Flag, Info, MoonStar, PhoneCall, Sun, Trash2, Undo2 } from "lucide-react";
import {
  completeTask,
  deleteActivity,
  deleteTask,
  markContacted,
  reopenTask,
  rescheduleTask,
  setTaskPriority,
  snoozeTask,
  unsnoozeTask,
} from "@/server/actions";
import { Sheet, SheetOption, useAction } from "./feedback";
import { Badge, buttonClass, cx } from "./ui";

export interface TaskView {
  id: string;
  title: string;
  kind: "task" | "follow_up" | "prep";
  scope: "personal" | "business";
  priority: "high" | "normal";
  status: "open" | "done" | "cancelled";
  dueDate: string | null;
  dueLabel?: string | null;
  dueAtLabel?: string | null;
  reason?: string | null;
  overdue?: boolean;
  snoozed?: boolean;
  contactName?: string | null;
  source?: string;
}

function addDaysLocal(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function CheckCircle({ checked, onClick, label, disabled }: { checked: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className="-m-2 grid size-12 shrink-0 place-items-center rounded-full disabled:opacity-50"
    >
      <span
        className={cx(
          "grid size-[26px] place-items-center rounded-full border-2 transition-all duration-200",
          checked ? "border-good bg-good text-bg" : "border-white/25 active:border-accent active:bg-accent/10",
        )}
      >
        {checked && <Check size={16} strokeWidth={3.2} className="animate-pop" />}
      </span>
    </button>
  );
}

export function TaskRow({ task, showReason = false }: { task: TaskView; showReason?: boolean }) {
  const [open, setOpen] = useState(false);
  const [optimisticDone, setOptimisticDone] = useState(task.status === "done");
  const { run, pending } = useAction();

  const toggle = async () => {
    if (optimisticDone) {
      setOptimisticDone(false);
      await run(() => reopenTask(task.id), { success: "Reopened" });
      return;
    }
    setOptimisticDone(true);
    const r = await run(() => completeTask(task.id), { undo: () => () => reopenTask(task.id) });
    if (!r?.ok) setOptimisticDone(false);
  };

  const meta: string[] = [];
  if (task.dueLabel) meta.push(task.dueLabel);
  if (task.dueAtLabel) meta.push(task.dueAtLabel);

  return (
    <>
      <div className={cx("flex min-h-[60px] items-center gap-3 px-4 py-2.5 transition-opacity", optimisticDone && "opacity-55")}>
        <CheckCircle checked={optimisticDone} onClick={toggle} label={`Complete ${task.title}`} disabled={pending} />
        <button onClick={() => setOpen(true)} className="min-w-0 flex-1 py-1 text-left" aria-label={`Options for ${task.title}`}>
          <span className={cx("block text-[16px] leading-snug text-ink", optimisticDone && "line-through decoration-white/30")}>{task.title}</span>
          {(showReason && task.reason) || meta.length > 0 || task.kind === "follow_up" || task.scope === "business" || task.priority === "high" ? (
            <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
              {showReason && task.reason && <span className={cx(task.overdue ? "text-bad" : "text-accent")}>{task.reason}</span>}
              {!showReason && meta.length > 0 && <span className={cx(task.overdue && "text-bad")}>{meta.join(" · ")}</span>}
              {task.priority === "high" && !showReason && <Flag size={13} className="text-warn" aria-label="High priority" />}
              {task.kind === "follow_up" && <Badge tone="accent">Follow-up</Badge>}
              {task.scope === "business" && <Badge tone="business">Business</Badge>}
            </span>
          ) : null}
        </button>
      </div>
      <TaskActions task={task} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function TaskActions({ task, open, onClose }: { task: TaskView; open: boolean; onClose: () => void }) {
  const { run, pending } = useAction();
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState(task.dueDate ?? addDaysLocal(1));
  const [time, setTime] = useState("");

  const act = async (fn: () => Promise<{ ok: boolean }>, undo?: () => Promise<unknown>) => {
    const r = await run(fn as never, undo ? { undo: () => undo } : {});
    if (r) onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={task.title}>
      {!picking ? (
        <div className="-mx-2 space-y-0.5">
          {task.kind === "follow_up" && task.status === "open" && (
            <SheetOption
              icon={<PhoneCall size={18} />}
              label="I contacted them"
              detail="Logs the contact and completes this follow-up"
              disabled={pending}
              onClick={async () => {
                const r = await run(() => markContacted(task.id), {
                  undo: (res) => () => deleteActivity((res as { data?: { activityId: string } }).data!.activityId),
                });
                if (r) onClose();
              }}
            />
          )}
          {task.snoozed ? (
            <SheetOption icon={<Undo2 size={18} />} label="Unsnooze" disabled={pending} onClick={() => act(() => unsnoozeTask(task.id))} />
          ) : (
            <>
              <SheetOption icon={<AlarmClock size={18} />} label="Snooze 3 hours" disabled={pending} onClick={() => act(() => snoozeTask(task.id, "later_today"), () => unsnoozeTask(task.id))} />
              <SheetOption icon={<Sun size={18} />} label="Snooze until tomorrow" detail="Back at 8:00 AM" disabled={pending} onClick={() => act(() => snoozeTask(task.id, "tomorrow"), () => unsnoozeTask(task.id))} />
              <SheetOption icon={<MoonStar size={18} />} label="Snooze until next week" detail="Back Monday 8:00 AM" disabled={pending} onClick={() => act(() => snoozeTask(task.id, "next_week"), () => unsnoozeTask(task.id))} />
            </>
          )}
          <SheetOption icon={<CalendarArrowUp size={18} />} label="Move to tomorrow" disabled={pending} onClick={() => act(() => rescheduleTask(task.id, addDaysLocal(1)), task.dueDate ? () => rescheduleTask(task.id, task.dueDate) : () => rescheduleTask(task.id, null))} />
          <SheetOption icon={<CalendarDays size={18} />} label="Pick a date…" disabled={pending} onClick={() => setPicking(true)} />
          <SheetOption
            icon={<Flag size={18} />}
            label={task.priority === "high" ? "Remove high priority" : "Mark high priority"}
            disabled={pending}
            onClick={() => act(() => setTaskPriority(task.id, task.priority === "high" ? "normal" : "high"))}
          />
          <SheetOption icon={<Trash2 size={18} />} label="Remove task" tone="danger" disabled={pending} onClick={() => act(() => deleteTask(task.id), () => reopenTask(task.id))} />
          <p className="flex items-center gap-2 px-3 pt-4 text-[13px] text-faint">
            <Info size={14} />
            {task.source === "capture" ? "Added from quick capture" : task.source === "review" ? "Added during weekly review" : "Added manually"}
            {task.scope === "business" && (
              <>
                {" "}
                · <Briefcase size={13} /> Business
              </>
            )}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="flex h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4">
            <CalendarDays size={18} className="text-muted" />
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="flex-1 bg-transparent text-[16px] outline-none [color-scheme:dark]" aria-label="New date" />
          </label>
          <label className="flex h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4">
            <AlarmClock size={18} className="text-muted" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className="flex-1 bg-transparent text-[16px] outline-none [color-scheme:dark]" aria-label="Time (optional)" />
            <span className="text-[13px] text-faint">Optional</span>
          </label>
          <div className="flex gap-2 pt-2">
            <button className={buttonClass("secondary", "lg")} onClick={() => setPicking(false)}>
              Back
            </button>
            <button className={cx(buttonClass("primary", "lg"), "flex-1")} disabled={!date || pending} onClick={() => act(() => rescheduleTask(task.id, date, time || null))}>
              Reschedule
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
