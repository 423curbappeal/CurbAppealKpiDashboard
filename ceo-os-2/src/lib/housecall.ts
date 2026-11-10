/**
 * Housecall Pro → CEO OS mapping. Pure functions, no I/O.
 *
 * Field names and status values were verified against a live MAX-plan account
 * (Nov 2026), not guessed:
 *  - estimate.work_status: "needs scheduling" | "created job from estimate" | "pro canceled" | "user canceled"
 *  - option.status: "submitted for signoff" | "needs scheduling" | "created job from estimate" | "deleted" | "canceled"
 *  - option.approval_status: null | "approved" | "pro approved" | "declined" | "pro declined" | "expired"
 *  - job.work_status: "needs scheduling" | "scheduled" | "in progress" | "complete unrated" | "complete rated" | "pro canceled" | "user canceled"
 *  - amounts are integer cents; schedule.scheduled_start is UTC ISO.
 */

export interface HcpCustomer {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company?: string | null;
}

export interface HcpOption {
  id: string;
  name?: string | null;
  total_amount: number | null;
  status: string | null;
  approval_status: string | null;
  created_at: string;
  updated_at?: string;
}

export interface HcpEstimate {
  id: string;
  estimate_number: string | null;
  work_status: string | null;
  customer: HcpCustomer | null;
  created_at: string;
  options: HcpOption[];
}

export interface HcpJob {
  id: string;
  invoice_number?: string | null;
  description?: string | null;
  work_status: string | null;
  customer: HcpCustomer | null;
  address?: { street?: string | null; city?: string | null } | null;
  schedule?: { scheduled_start: string | null; scheduled_end: string | null } | null;
  total_amount?: number | null;
  job_fields?: { job_type?: { name?: string | null } | null } | null;
  created_at: string;
  deleted_at?: string | null;
  canceled_at?: string | null;
}

const APPROVED = new Set(["approved", "pro approved"]);
const DECLINED = new Set(["declined", "pro declined"]);
const DEAD_OPTION = new Set(["deleted", "canceled"]);

export type EstimateState =
  | { kind: "awaiting"; valueCents: number; optionCount: number; sentAt: string }
  | { kind: "approved_unscheduled"; valueCents: number; sentAt: string }
  | { kind: "closed"; outcome: "converted" | "approved" | "declined" | "expired" | "canceled"; reason: string };

/** What does this estimate mean for the owner right now? */
export function classifyEstimate(e: HcpEstimate): EstimateState {
  const ws = (e.work_status ?? "").toLowerCase();
  if (ws === "created job from estimate") return { kind: "closed", outcome: "converted", reason: "Converted to a job in Housecall Pro" };
  if (ws.includes("canceled")) return { kind: "closed", outcome: "canceled", reason: "Canceled in Housecall Pro" };

  const live = e.options.filter((o) => !DEAD_OPTION.has((o.status ?? "").toLowerCase()));
  if (live.length === 0) return { kind: "closed", outcome: "canceled", reason: "All options removed in Housecall Pro" };

  const approved = live.filter((o) => APPROVED.has((o.approval_status ?? "").toLowerCase()));
  if (approved.length > 0) {
    return { kind: "approved_unscheduled", valueCents: Math.max(...approved.map((o) => o.total_amount ?? 0)), sentAt: earliest(approved) };
  }

  const pending = live.filter((o) => o.approval_status === null && (o.status ?? "").toLowerCase() === "submitted for signoff");
  if (pending.length > 0) {
    return { kind: "awaiting", valueCents: Math.max(...pending.map((o) => o.total_amount ?? 0)), optionCount: pending.length, sentAt: earliest(pending) };
  }

  if (live.some((o) => (o.approval_status ?? "").toLowerCase() === "expired")) return { kind: "closed", outcome: "expired", reason: "Expired in Housecall Pro" };
  if (live.some((o) => DECLINED.has((o.approval_status ?? "").toLowerCase()))) return { kind: "closed", outcome: "declined", reason: "Declined in Housecall Pro" };
  // Draft options (not yet sent) are not a follow-up.
  return { kind: "closed", outcome: "canceled", reason: "Not sent to the customer" };
}

function earliest(options: HcpOption[]): string {
  return options.map((o) => o.created_at).sort()[0]!;
}

export function customerName(c: HcpCustomer | null): string | null {
  if (!c) return null;
  const name = [c.first_name, c.last_name].filter(Boolean).join(" ").trim();
  return name || c.company?.trim() || null;
}

export function formatCents(cents: number): string {
  return "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 });
}

export interface TaskDraft {
  sourceRef: string;
  title: string;
  notes: string;
  contactName: string | null;
  kind: "follow_up" | "task";
  createdAt: Date;
  external: { provider: "housecall_pro"; type: "estimate" | "approved_estimate" | "job"; number: string | null; amountCents: number | null; customer: string | null };
}

export function estimateTask(e: HcpEstimate, state: Extract<EstimateState, { kind: "awaiting" | "approved_unscheduled" }>): TaskDraft {
  const who = customerName(e.customer);
  const num = e.estimate_number ? `#${e.estimate_number}` : "";
  const amount = state.valueCents > 0 ? formatCents(state.valueCents) : null;
  if (state.kind === "approved_unscheduled") {
    return {
      sourceRef: `hcp:estimate:${e.id}`,
      title: `Schedule approved estimate${who ? ` for ${who}` : ""}`,
      notes: [`Estimate ${num}`.trim(), amount, "Approved — no job created yet"].filter(Boolean).join(" · "),
      contactName: who,
      kind: "task",
      createdAt: new Date(state.sentAt),
      external: { provider: "housecall_pro", type: "approved_estimate", number: e.estimate_number, amountCents: state.valueCents, customer: who },
    };
  }
  const value = amount ? (state.optionCount > 1 ? `up to ${amount}` : amount) : null;
  return {
    sourceRef: `hcp:estimate:${e.id}`,
    title: `Follow up${who ? ` with ${who}` : ""} on estimate${num ? ` ${num}` : ""}`,
    notes: [value, state.optionCount > 1 ? `${state.optionCount} options` : null, "Awaiting customer approval"].filter(Boolean).join(" · "),
    contactName: who,
    kind: "follow_up",
    createdAt: new Date(state.sentAt),
    external: { provider: "housecall_pro", type: "estimate", number: e.estimate_number, amountCents: state.valueCents, customer: who },
  };
}

export function isUnscheduledJob(j: HcpJob): boolean {
  return (j.work_status ?? "").toLowerCase() === "needs scheduling" && !j.deleted_at && !j.canceled_at;
}

export function jobClosedReason(j: HcpJob): string | null {
  const ws = (j.work_status ?? "").toLowerCase();
  if (j.deleted_at) return "Deleted in Housecall Pro";
  if (ws.includes("canceled") || j.canceled_at) return "Canceled in Housecall Pro";
  if (ws === "needs scheduling") return null;
  return "Scheduled in Housecall Pro";
}

export function jobTask(j: HcpJob): TaskDraft {
  const who = customerName(j.customer);
  const type = j.job_fields?.job_type?.name ?? null;
  const amount = j.total_amount ? formatCents(j.total_amount) : null;
  return {
    sourceRef: `hcp:job:${j.id}`,
    title: `Schedule ${type ? type.toLowerCase() : "job"}${who ? ` for ${who}` : ""}`,
    notes: [j.invoice_number ? `Job #${j.invoice_number}` : null, amount, "Needs scheduling"].filter(Boolean).join(" · "),
    contactName: who,
    kind: "task",
    createdAt: new Date(j.created_at),
    external: { provider: "housecall_pro", type: "job", number: j.invoice_number ?? null, amountCents: j.total_amount ?? null, customer: who },
  };
}

export function jobEvent(j: HcpJob) {
  const start = j.schedule?.scheduled_start;
  const end = j.schedule?.scheduled_end;
  if (!start || !end || j.deleted_at || j.canceled_at || (j.work_status ?? "").toLowerCase().includes("canceled")) return null;
  const startsAt = new Date(start);
  const endsAt = new Date(end);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  const who = customerName(j.customer);
  const type = j.job_fields?.job_type?.name ?? "Job";
  const location = [j.address?.street, j.address?.city].filter(Boolean).join(", ") || null;
  return { externalId: `job:${j.id}`, title: `${type}${who ? ` · ${who}` : ""}`, startsAt, endsAt, allDay: false, location, htmlLink: null };
}

/* ── Business KPIs ──────────────────────────────────────────────────────────
 * Figures come only from Housecall Pro records: a completed job's total_amount,
 * dated by its scheduled start in the owner's timezone. Nothing is estimated.
 */

export interface BusinessKpis {
  asOf: string;
  today: string;
  /** Completed-job totals, period to date, in cents. */
  revenueCents: { week: number; month: number; quarter: number; year: number };
  /** Same days of last month (1st through today's day number), for comparison. */
  lastMonthToDateCents: number;
  jobsCompletedMonth: number;
  avgTicketCentsMonth: number | null;
  /** Estimates sent in the last 60 days that reached a decision. */
  closeRate: { won: number; lost: number; pct: number | null };
  scheduledNext7: number;
  scheduledNext7ValueCents: number;
  /** True when the job list hit the page cap, so totals may be low. */
  cut: boolean;
}

const COMPLETE = /^complete/i;

export function isCompletedJob(j: HcpJob): boolean {
  return COMPLETE.test(j.work_status ?? "") && !j.deleted_at && !j.canceled_at;
}

function localDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

function shiftDays(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Monday-start week, matching the rest of the app. */
function weekStartOf(d: string): string {
  const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
  return shiftDays(d, -((dow + 6) % 7));
}

export function kpiWindowStart(today: string): string {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const lastMonth = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const yearStart = `${y}-01-01`;
  return lastMonth < yearStart ? lastMonth : yearStart;
}

export function businessKpis(input: {
  completedWindowJobs: HcpJob[];
  upcomingJobs: HcpJob[];
  estimates: HcpEstimate[];
  now: Date;
  timeZone: string;
  cut: boolean;
}): BusinessKpis {
  const { now, timeZone } = input;
  const today = localDay(now.toISOString(), timeZone);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const pad = (n: number) => String(n).padStart(2, "0");
  const starts = {
    week: weekStartOf(today),
    month: `${y}-${pad(m)}-01`,
    quarter: `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`,
    year: `${y}-01-01`,
  };
  const lm = new Date(Date.UTC(y, m - 2, 1));
  const lmStart = lm.toISOString().slice(0, 10);
  const lmDays = new Date(Date.UTC(y, m - 1, 0)).getUTCDate();
  const lmEnd = `${lmStart.slice(0, 8)}${pad(Math.min(d, lmDays))}`;

  const seen = new Set<string>();
  const done = input.completedWindowJobs
    .filter((j) => isCompletedJob(j) && j.schedule?.scheduled_start && !seen.has(j.id) && seen.add(j.id))
    .map((j) => ({ day: localDay(j.schedule!.scheduled_start!, timeZone), cents: j.total_amount ?? 0 }))
    .filter((j) => j.day <= today);
  const sum = (from: string, to = today) => done.filter((j) => j.day >= from && j.day <= to).reduce((s, j) => s + j.cents, 0);
  const monthJobs = done.filter((j) => j.day >= starts.month);

  let won = 0;
  let lost = 0;
  const since = now.getTime() - 60 * 86_400_000;
  for (const e of input.estimates) {
    if (new Date(e.created_at).getTime() < since) continue;
    const s = classifyEstimate(e);
    if (s.kind === "approved_unscheduled" || (s.kind === "closed" && (s.outcome === "converted" || s.outcome === "approved"))) won++;
    else if (s.kind === "closed" && (s.outcome === "declined" || s.outcome === "expired")) lost++;
  }

  const horizon = now.getTime() + 7 * 86_400_000;
  const upcoming = input.upcomingJobs.filter((j) => {
    const t = j.schedule?.scheduled_start ? new Date(j.schedule.scheduled_start).getTime() : NaN;
    return t >= now.getTime() && t <= horizon && !j.deleted_at && !j.canceled_at && !/canceled/i.test(j.work_status ?? "") && !isCompletedJob(j);
  });

  return {
    asOf: now.toISOString(),
    today,
    revenueCents: { week: sum(starts.week), month: sum(starts.month), quarter: sum(starts.quarter), year: sum(starts.year) },
    lastMonthToDateCents: sum(lmStart, lmEnd),
    jobsCompletedMonth: monthJobs.length,
    avgTicketCentsMonth: monthJobs.length ? Math.round(monthJobs.reduce((s, j) => s + j.cents, 0) / monthJobs.length) : null,
    closeRate: { won, lost, pct: won + lost > 0 ? (won / (won + lost)) * 100 : null },
    scheduledNext7: upcoming.length,
    scheduledNext7ValueCents: upcoming.reduce((s, j) => s + (j.total_amount ?? 0), 0),
    cut: input.cut,
  };
}
