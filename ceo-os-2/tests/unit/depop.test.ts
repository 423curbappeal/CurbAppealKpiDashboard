import { describe, expect, it } from "vitest";
import { buildBriefing } from "@/lib/briefing";
import { zonedTimeToUtc } from "@/lib/dates";
import {
  daysListed,
  depopSnapshot,
  depopStats,
  estimateFeesCents,
  feesFor,
  formatCents,
  parseMoneyToCents,
  profitCents,
  type DepopItemLike,
} from "@/lib/depop";

const today = "2026-11-09";

function item(over: Partial<DepopItemLike> & { id: string }): DepopItemLike {
  return {
    title: over.id,
    category: "Tops",
    brand: null,
    size: null,
    costCents: 500,
    listPriceCents: 3000,
    listedOn: "2026-10-01",
    soldOn: null,
    salePriceCents: null,
    feesCents: null,
    shippingCents: 0,
    ...over,
  };
}

describe("depop money", () => {
  it("parses what people type into cents", () => {
    expect(parseMoneyToCents("12")).toBe(1200);
    expect(parseMoneyToCents("12.5")).toBe(1250);
    expect(parseMoneyToCents("$1,200.99")).toBe(120099);
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("12.345")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
  });

  it("formats whole and exact amounts", () => {
    expect(formatCents(123456)).toBe("$1,235");
    expect(formatCents(4550)).toBe("$45.50");
    expect(formatCents(4500)).toBe("$45");
    expect(formatCents(4500, { exact: true })).toBe("$45.00");
    expect(formatCents(-850, { exact: true })).toBe("−$8.50");
  });

  it("estimates fees only when the user left them blank, and says so", () => {
    expect(estimateFeesCents(3000)).toBe(144); // 3.3% of $30 + $0.45
    expect(feesFor(item({ id: "a", soldOn: "2026-11-01", salePriceCents: 3000 }))).toEqual({ cents: 144, estimated: true });
    expect(feesFor(item({ id: "b", soldOn: "2026-11-01", salePriceCents: 3000, feesCents: 0 }))).toEqual({ cents: 0, estimated: false });
    expect(feesFor(item({ id: "c" }))).toEqual({ cents: 0, estimated: false });
  });

  it("profit is sale − cost − fees − shipping, and null while listed", () => {
    expect(profitCents(item({ id: "a", soldOn: "2026-11-01", salePriceCents: 3000, feesCents: 100, shippingCents: 450 }))).toBe(3000 - 500 - 100 - 450);
    expect(profitCents(item({ id: "b" }))).toBeNull();
  });
});

describe("depopStats", () => {
  const items: DepopItemLike[] = [
    // last 30 days (Oct 11 – Nov 9)
    item({ id: "s1", listedOn: "2026-10-20", soldOn: "2026-11-05", salePriceCents: 4000, feesCents: 200 }),
    item({ id: "s2", listedOn: "2026-10-01", soldOn: "2026-10-11", salePriceCents: 2000, feesCents: 100, category: "Shoes" }),
    // prior 30 days (Sep 11 – Oct 10)
    item({ id: "p1", listedOn: "2026-09-01", soldOn: "2026-10-10", salePriceCents: 2000, feesCents: 100 }),
    // active, one stale
    item({ id: "a1", listedOn: "2026-11-01", costCents: 800 }),
    item({ id: "a2", listedOn: "2026-08-01", costCents: 200 }),
  ];
  const s = depopStats(items, today);

  it("windows are inclusive and do not overlap", () => {
    expect(s.last30.sold).toBe(2);
    expect(s.prior30.sold).toBe(1);
    expect(s.last7.sold).toBe(1);
  });

  it("computes the 30-day KPIs", () => {
    expect(s.last30.revenueCents).toBe(6000);
    expect(s.last30.profitCents).toBe(4000 - 500 - 200 + (2000 - 500 - 100));
    expect(s.last30.avgSaleCents).toBe(3000);
    expect(s.last30.avgDaysToSell).toBe((16 + 10) / 2);
    expect(s.last30.feesEstimated).toBe(false);
    expect(s.change.revenuePct).toBe(200);
    expect(s.change.soldPct).toBe(100);
  });

  it("tracks inventory, stale listings and sell-through", () => {
    expect(s.active).toBe(2);
    expect(s.inventoryCostCents).toBe(1000);
    expect(s.stale).toBe(1);
    expect(daysListed(items[4]!, today)).toBe(100);
    expect(s.sellThroughPct).toBe(50);
  });

  it("builds six month buckets ending this month, and ranks categories by profit", () => {
    expect(s.months.map((m) => m.label)).toEqual(["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"]);
    expect(s.months.at(-1)!.revenueCents).toBe(4000);
    expect(s.months.at(-2)!.sold).toBe(2);
    expect(s.categories[0]!.category).toBe("Tops");
  });

  it("has no change figures without a prior period, and is empty with no items", () => {
    const fresh = depopStats([item({ id: "x", soldOn: "2026-11-08", salePriceCents: 1000 })], today);
    expect(fresh.change.revenuePct).toBeNull();
    expect(fresh.last30.feesEstimated).toBe(true);
    const none = depopStats([], today);
    expect(none.hasItems).toBe(false);
    expect(none.sellThroughPct).toBeNull();
    expect(depopSnapshot(none)).toBeNull();
  });
});

describe("briefing with Depop", () => {
  const base = {
    now: zonedTimeToUtc(today, "08:00", "America/New_York"),
    timeZone: "America/New_York",
    firstName: "Ro",
    tasks: [],
    routines: [],
    routineIdsDoneToday: new Set<string>(),
    events: [],
    workoutsThisWeek: 0,
    weeklyWorkoutTarget: 0,
    lastWorkoutDate: null,
    calendar: "not_connected" as const,
  };

  it("adds a factual shop line and a stale-listing alert", () => {
    const b = buildBriefing({ ...base, depop: { last7ProfitCents: 3300, last7Sold: 1, active: 2, stale: 1, feesEstimated: false } });
    expect(b.summary).toContain("Depop: 1 sale in the last 7 days, $33 profit. 2 listings active.");
    expect(b.alerts.map((a) => a.id)).toContain("depop-stale");
    expect(b.isEmpty).toBe(false);
  });

  it("flags estimated fees and quiet weeks", () => {
    const b = buildBriefing({ ...base, depop: { last7ProfitCents: 0, last7Sold: 0, active: 3, stale: 0, feesEstimated: false } });
    expect(b.summary).toContain("Depop: no sales in the last 7 days. 3 listings active.");
    expect(b.alerts.map((a) => a.id)).not.toContain("depop-stale");
    const est = buildBriefing({ ...base, depop: { last7ProfitCents: 1000, last7Sold: 2, active: 0, stale: 0, feesEstimated: true } });
    expect(est.summary[0]).toContain("(fees estimated)");
  });

  it("stays out of the briefing when nothing has been logged", () => {
    const b = buildBriefing({ ...base, depop: null });
    expect(b.summary.some((l) => l.startsWith("Depop"))).toBe(false);
    expect(b.isEmpty).toBe(true);
  });
});
