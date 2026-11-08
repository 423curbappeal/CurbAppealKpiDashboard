"use client";

import { ChevronRight, MessageSquarePlus } from "lucide-react";
import { useCapture } from "@/components/capture";

export function CaptureHint({ label = "Capture your first task" }: { label?: string }) {
  const open = useCapture();
  return (
    <button onClick={() => open()} className="flex min-h-14 w-full items-center gap-4 rounded-2xl bg-white/[0.04] px-4 text-left active:bg-white/[0.08]">
      <MessageSquarePlus size={20} className="text-accent" />
      <span className="flex-1 text-[15px] font-medium">{label}</span>
      <ChevronRight size={18} className="text-faint" />
    </button>
  );
}

export function InlineCapture() {
  const open = useCapture();
  return (
    <button
      onClick={() => open()}
      className="flex h-14 w-full items-center gap-3 rounded-[18px] border border-line bg-surface px-4 text-left text-[16px] text-faint active:bg-raised"
    >
      <MessageSquarePlus size={20} className="text-accent" />
      Add anything — “Call Dana Friday”
    </button>
  );
}
