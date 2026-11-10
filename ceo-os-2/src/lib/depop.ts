/**
 * Depop shop math. Pure functions, no I/O.
 *
 * Product rules:
 * - Fees the user entered are used as-is. When fees are blank we estimate
 *   Depop's US payment processing fee (3.3% + $0.45) and say so: every
 *   figure that leans on an estimate reports `feesEstimated`.
 * - Profit = sale price − item cost − fees − shipping the seller paid.
 * - "Last 30 days" ends today (inclusive), in the user's timezone.
 */
import { addDays, diffDays, type DateString } from "./dates";

export const STALE_AFTER_DAYS = 60;
export const FEE_RATE = 0.033;
export const FEE_FIXED_CENTS = 45;

export interface DepopItemLike {
  id: string;
  title: string;
  category: string | null;
  brand: string | null;
  size: string | null;
  costCents: number;
  listPriceCents: number | null;
  listedOn: DateString;
  soldOn: DateString | null;
  salePriceCents: number | null;
  feesCents: number | null;
  shippingCents: number;
}

export function estimateFeesCents(salePriceCents: number): number {
  return Math.round(salePriceCents * FEE_RATE + FEE_FIXED_CENTS);
}

export function feesFor(item: DepopItemLike): { cents: number; estimated: boolean } {
  if (item.soldOn === null || item.salePriceCents === null) return { cents: 0, estimated: false };
  if (item.feesCents !== null) return { cents: item.feesCents, estimated: false };
  return { cents: estimateFeesCents(item.salePriceCents), estimated: true };
}

export function profitCents(item: DepopItemLike): number | null {
  if (item.soldOn === null || item.salePriceCents === null) return null;
  return item.salePriceCents - item.costCents - feesFor(item).cents - item.shippingCents;
}

export function daysToSell(item: DepopItemLike): number | null {
  if (item.soldOn === null) return null;
  return Math.max(0, diffDays(item.listedOn, item.soldOn));
}

export function daysListed(item: DepopItemLike, today: DateString): number {
  return Math.max(0, diffDays(item.listedOn, item.soldOn ?? today));
}

export interface PeriodStats {
  revenueCents: number;
  profitCents: number;
  sold: number;
  avgSaleCents: number | null;
  /** Profit ÷ revenue, 0–100. Null with no revenue. */
  marginPct: number | null;
  avgDaysToSell: number | null;
  feesEstimated: boolean;
}

function periodStats(sold: DepopItemLike[]): PeriodStats {
  const revenue = sold.reduce((s, i) => s + (i.salePriceCents ?? 0), 0);
  const profit = sold.reduce((s, i) => s + (profitCents(i) ?? 0), 0);
  const days = sold.map(daysToSell).filter((d): d is number => d !== null);
  return {
    revenueCents: revenue,
    profitCents: profit,
    sold: sold.length,
    avgSaleCents: sold.length ? Math.round(revenue / sold.length) : null,
    marginPct: revenue > 0 ? (profit / revenue) * 100 : null,
    avgDaysToSell: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null,
    feesEstimated: sold.some((i) => feesFor(i).estimated),
  };
}

/** Items sold in the `days` days ending `endOffset` days before today (inclusive window). */
function soldInWindow(items: DepopItemLike[], today: DateString, days: number, endOffset = 0): DepopItemLike[] {
  const end = addDays(today, -endOffset);
  const start = addDays(end, -(days - 1));
  return items.filter((i) => i.soldOn !== null && i.soldOn >= start && i.soldOn <= end);
}

/** Percent change from b to a. Null when there is no baseline. */
export function pctChange(a: number, b: number): number | null {
  if (b === 0) return null;
  return ((a - b) / Math.abs(b)) * 100;
}

export interface MonthBar {
  month: string; // YYYY-MM
  label: string; // "Nov"
  revenueCents: number;
  profitCents: number;
  sold: number;
}

export interface CategoryRow {
  category: string;
  sold: number;
  revenueCents: number;
  profitCents: number;
  marginPct: number | null;
  avgDaysToSell: number | null;
}

export interface DepopStats {
  hasItems: boolean;
  last30: PeriodStats;
  prior30: PeriodStats;
  last7: PeriodStats;
  change: {
    revenuePct: number | null;
    profitPct: number | null;
    soldPct: number | null;
    avgSalePct: number | null;
    marginPts: number | null;
    avgDaysDelta: number | null;
  };
  active: number;
  inventoryCostCents: number;
  inventoryListValueCents: number;
  stale: number;
  /** Sold in the last 30 days ÷ (that + still listed), 0–100. */
  sellThroughPct: number | null;
  months: MonthBar[];
  categories: CategoryRow[];
  allTime: PeriodStats;
}

const MONTH_LABEL = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function depopStats(items: DepopItemLike[], today: DateString, monthsBack = 6): DepopStats {
  const last30 = periodStats(soldInWindow(items, today, 30));
  const prior30 = periodStats(soldInWindow(items, today, 30, 30));
  const last7 = periodStats(soldInWindow(items, today, 7));
  const active = items.filter((i) => i.soldOn === null);
  const stale = active.filter((i) => daysListed(i, today) > STALE_AFTER_DAYS);

  const [ty, tm] = today.split("-").map(Number) as [number, number];
  const months: MonthBar[] = [];
  for (let k = monthsBack - 1; k >= 0; k--) {
    const d = new Date(Date.UTC(ty, tm - 1 - k, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const sold = items.filter((i) => i.soldOn !== null && i.soldOn.startsWith(key));
    const p = periodStats(sold);
    months.push({ month: key, label: MONTH_LABEL[d.getUTCMonth()]!, revenueCents: p.revenueCents, profitCents: p.profitCents, sold: p.sold });
  }

  const recent = soldInWindow(items, today, 90);
  const byCat = new Map<string, DepopItemLike[]>();
  for (const i of recent) {
    const c = i.category?.trim() || "Uncategorized";
    byCat.set(c, [...(byCat.get(c) ?? []), i]);
  }
  const categories: CategoryRow[] = [...byCat.entries()]
    .map(([category, rows]) => {
      const p = periodStats(rows);
      return { category, sold: p.sold, revenueCents: p.revenueCents, profitCents: p.profitCents, marginPct: p.marginPct, avgDaysToSell: p.avgDaysToSell };
    })
    .sort((a, b) => b.profitCents - a.profitCents);

  return {
    hasItems: items.length > 0,
    last30,
    prior30,
    last7,
    change: {
      revenuePct: pctChange(last30.revenueCents, prior30.revenueCents),
      profitPct: pctChange(last30.profitCents, prior30.profitCents),
      soldPct: pctChange(last30.sold, prior30.sold),
      avgSalePct: last30.avgSaleCents !== null && prior30.avgSaleCents !== null ? pctChange(last30.avgSaleCents, prior30.avgSaleCents) : null,
      marginPts: last30.marginPct !== null && prior30.marginPct !== null ? last30.marginPct - prior30.marginPct : null,
      avgDaysDelta: last30.avgDaysToSell !== null && prior30.avgDaysToSell !== null ? last30.avgDaysToSell - prior30.avgDaysToSell : null,
    },
    active: active.length,
    inventoryCostCents: active.reduce((s, i) => s + i.costCents, 0),
    inventoryListValueCents: active.reduce((s, i) => s + (i.listPriceCents ?? 0), 0),
    stale: stale.length,
    sellThroughPct: last30.sold + active.length > 0 ? (last30.sold / (last30.sold + active.length)) * 100 : null,
    months,
    categories,
    allTime: periodStats(items.filter((i) => i.soldOn !== null)),
  };
}

/** What Home's briefing needs. Null when the user has never logged an item. */
export interface DepopSnapshot {
  last7ProfitCents: number;
  last7Sold: number;
  active: number;
  stale: number;
  feesEstimated: boolean;
}

export function depopSnapshot(stats: DepopStats): DepopSnapshot | null {
  if (!stats.hasItems) return null;
  return {
    last7ProfitCents: stats.last7.profitCents,
    last7Sold: stats.last7.sold,
    active: stats.active,
    stale: stats.stale,
    feesEstimated: stats.last7.feesEstimated,
  };
}

/** "$12.50" → 1250. Accepts "12", "12.5", "$1,200.00". Null for blank or invalid. */
export function parseMoneyToCents(input: string): number | null {
  const t = input.replace(/[$,\s]/g, "");
  if (t === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export function formatCents(cents: number, opts: { exact?: boolean } = {}): string {
  const sign = cents < 0 ? "−" : "";
  const abs = Math.abs(cents) / 100;
  const s = opts.exact || abs < 100
    ? abs.toLocaleString("en-US", { minimumFractionDigits: abs % 1 === 0 && !opts.exact ? 0 : 2, maximumFractionDigits: 2 })
    : Math.round(abs).toLocaleString("en-US");
  return `${sign}$${s}`;
}

/** Profit in cents from items sold between `start` and `today`, inclusive. */
export function profitBetween(items: DepopItemLike[], start: DateString, today: DateString): { cents: number; feesEstimated: boolean } {
  const sold = items.filter((i) => i.soldOn !== null && i.soldOn >= start && i.soldOn <= today);
  return { cents: sold.reduce((s, i) => s + (profitCents(i) ?? 0), 0), feesEstimated: sold.some((i) => feesFor(i).estimated) };
}
