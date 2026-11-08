import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cx("mx-auto w-full max-w-[560px] px-5 pt-safe pb-tabbar", className)}>{children}</main>;
}

export function ScreenHeader({ eyebrow, title, trailing }: { eyebrow?: ReactNode; title: ReactNode; trailing?: ReactNode }) {
  return (
    <header className="flex items-end justify-between gap-4 pt-6 pb-5">
      <div className="min-w-0">
        {eyebrow && <p className="text-[13px] font-medium tracking-wide text-faint uppercase">{eyebrow}</p>}
        <h1 className="mt-1 font-display text-[30px] leading-[1.1] font-semibold tracking-[-0.02em] text-ink">{title}</h1>
      </div>
      {trailing}
    </header>
  );
}

export function Card({ children, className, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cx("rounded-[var(--radius-card)] border border-line bg-surface", className)} {...rest}>
      {children}
    </section>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-8 mb-3 flex items-center justify-between px-1">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{children}</h2>
      {action}
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="-my-2 py-2 text-[14px] font-medium text-accent active:opacity-60">
      {children}
    </Link>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "lg" | "sm" = "md") {
  return cx(
    "inline-flex items-center justify-center gap-2 rounded-full font-semibold transition active:scale-[0.97] disabled:opacity-40 disabled:active:scale-100 select-none",
    size === "lg" && "h-14 px-6 text-[17px]",
    size === "md" && "h-12 px-5 text-[16px]",
    size === "sm" && "h-9 px-4 text-[14px]",
    variant === "primary" && "bg-accent text-accent-ink hover:bg-accent-strong",
    variant === "secondary" && "bg-raised text-ink border border-line-strong hover:bg-overlay",
    variant === "ghost" && "text-muted hover:text-ink",
    variant === "danger" && "bg-bad/15 text-bad border border-bad/25",
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "accent" | "good" | "warn" | "bad" | "business"; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex h-[22px] shrink-0 items-center rounded-full px-2 text-[12px] font-medium",
        tone === "neutral" && "bg-white/[0.06] text-muted",
        tone === "accent" && "bg-accent/15 text-accent",
        tone === "good" && "bg-good/15 text-good",
        tone === "warn" && "bg-warn/15 text-warn",
        tone === "bad" && "bg-bad/15 text-bad",
        tone === "business" && "bg-business/15 text-business",
      )}
    >
      {children}
    </span>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-8 text-center">
      {icon && <div className="mb-3 grid size-11 place-items-center rounded-full bg-white/[0.05] text-muted">{icon}</div>}
      <p className="text-[15px] font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-[28ch] text-[14px] leading-relaxed text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ProgressBar({ percent, tone = "accent" }: { percent: number | null; tone?: "accent" | "good" }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]" role="progressbar" aria-valuenow={percent ?? undefined} aria-valuemin={0} aria-valuemax={100}>
      {percent !== null && (
        <div
          className={cx("h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out-soft)]", tone === "good" ? "bg-good" : "bg-accent")}
          style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
        />
      )}
    </div>
  );
}

export function Ring({ percent, size = 56, stroke = 6, children }: { percent: number; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={p >= 100 ? "var(--color-good)" : "var(--color-accent)"}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (p / 100) * c}
          style={{ transition: "stroke-dashoffset 700ms var(--ease-out-soft)" }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}

export function ProvenanceBadge({ provenance }: { provenance: "actual" | "user_entered" | "unavailable" }) {
  if (provenance === "actual") return <Badge tone="good">Actual</Badge>;
  if (provenance === "user_entered") return <Badge tone="warn">You entered</Badge>;
  return <Badge>Not tracked</Badge>;
}
