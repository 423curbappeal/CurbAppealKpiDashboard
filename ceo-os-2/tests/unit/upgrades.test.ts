import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeDepopUrl, parseDepopListing, suggestCategory } from "@/lib/depop-import";
import { profitBetween, type DepopItemLike } from "@/lib/depop";
import { businessKpis, kpiWindowStart } from "@/lib/housecall";
import { goalProgress, periodStart, type GoalLike, type Metrics } from "@/lib/progress";
import { estimate, job, option } from "../fixtures/housecall";

describe("periodStart", () => {
  it("finds the start of each goal period (weeks start Monday)", () => {
    expect(periodStart("2026-11-09", "week")).toBe("2026-11-09"); // a Monday
    expect(periodStart("2026-11-15", "week")).toBe("2026-11-09"); // Sunday
    expect(periodStart("2026-11-09", "month")).toBe("2026-11-01");
    expect(periodStart("2026-11-09", "quarter")).toBe("2026-10-01");
    expect(periodStart("2026-02-14", "quarter")).toBe("2026-01-01");
    expect(periodStart("2026-11-09", "year")).toBe("2026-01-01");
  });
});

describe("goal progress from Depop and Housecall Pro", () => {
  const base: Metrics = { workoutsThisWeek: 0, tasksCompletedThisWeek: 0, routineConsistency7d: null, revenue: null, depopProfit: null };
  const goal = (over: Partial<GoalLike>): GoalLike => ({ id: "g", title: "t", area: "finance", metric: "depop_profit", period: "month", target: 500, unit: "$", manualCurrent: null, manualUpdatedAt: null, ...over });

  it("tracks Depop profit for the goal's own period, and says when fees were estimated", () => {
    const m = { ...base, depopProfit: { byPeriod: { week: 40, month: 250, quarter: 600, year: 1200 }, feesEstimated: true } };
    const p = goalProgress(goal({}), m);
    expect(p).toMatchObject({ current: 250, percent: 50, provenance: "actual", display: "$250 of $500 this month" });
    expect(p.sourceLabel).toContain("some fees estimated");
    expect(goalProgress(goal({ period: "year", target: 1000 }), m).percent).toBe(100);
  });

  it("is unavailable with nothing logged, never zero", () => {
    expect(goalProgress(goal({}), base)).toMatchObject({ current: null, provenance: "unavailable" });
  });

  it("uses completed-job revenue by period, labeled with its source", () => {
    const m = { ...base, revenue: { byPeriod: { week: 1000, month: 8000, quarter: 20000, year: 90000 }, asOf: new Date(), source: "completed jobs in Housecall Pro" } };
    const p = goalProgress(goal({ metric: "revenue", area: "business", target: 20000 }), m);
    expect(p).toMatchObject({ current: 8000, percent: 40, sourceLabel: "From completed jobs in Housecall Pro" });
  });

  it("profitBetween counts only sales inside the window", () => {
    const items: DepopItemLike[] = [
      { id: "a", title: "a", category: null, brand: null, size: null, costCents: 500, listPriceCents: null, listedOn: "2026-10-01", soldOn: "2026-11-02", salePriceCents: 3000, feesCents: 100, shippingCents: 0 },
      { id: "b", title: "b", category: null, brand: null, size: null, costCents: 500, listPriceCents: null, listedOn: "2026-10-01", soldOn: "2026-10-30", salePriceCents: 3000, feesCents: null, shippingCents: 0 },
    ];
    expect(profitBetween(items, "2026-11-01", "2026-11-09")).toEqual({ cents: 2400, feesEstimated: false });
    expect(profitBetween(items, "2026-10-01", "2026-11-09").feesEstimated).toBe(true);
  });
});

describe("business KPIs from Housecall Pro", () => {
  const NOW = new Date("2026-11-09T20:00:00Z"); // 3pm in Chattanooga
  const done = (id: string, start: string, cents: number, status = "complete rated") =>
    job(id, { work_status: status, total_amount: cents, schedule: { scheduled_start: start, scheduled_end: null } });

  const k = businessKpis({
    now: NOW,
    timeZone: "America/New_York",
    cut: false,
    completedWindowJobs: [
      done("j1", "2026-11-03T14:00:00Z", 45000),
      done("j2", "2026-11-09T13:00:00Z", 30000, "complete unrated"),
      done("j2", "2026-11-09T13:00:00Z", 30000, "complete unrated"), // duplicate across pages
      done("j3", "2026-10-05T14:00:00Z", 60000), // last month, within the 1st–9th window
      done("j4", "2026-10-20T14:00:00Z", 99900), // last month, after the 9th
      done("j5", "2026-11-01T03:00:00Z", 12300), // Oct 31 11pm local: last month
      job("j6", { work_status: "scheduled", total_amount: 50000, schedule: { scheduled_start: "2026-11-04T14:00:00Z", scheduled_end: null } }), // not complete
      done("j7", "2026-11-05T14:00:00Z", 70000, "pro canceled"),
    ],
    upcomingJobs: [
      job("u1", { work_status: "scheduled", total_amount: 41400, schedule: { scheduled_start: "2026-11-11T14:00:00Z", scheduled_end: null } }),
      job("u2", { work_status: "scheduled", total_amount: 20000, schedule: { scheduled_start: "2026-11-20T14:00:00Z", scheduled_end: null } }), // beyond 7 days
      job("u3", { work_status: "pro canceled", total_amount: 9900, schedule: { scheduled_start: "2026-11-12T14:00:00Z", scheduled_end: null } }),
    ],
    estimates: [
      estimate("e1", { work_status: "created job from estimate" }), // won
      estimate("e2", { options: [option({ approval_status: "approved" })] }), // won (approved, unscheduled)
      estimate("e3", { options: [option({ approval_status: "declined" })] }), // lost
      estimate("e4"), // awaiting: not counted
      estimate("e5", { created_at: "2026-08-01T00:00:00Z", work_status: "created job from estimate" }), // too old
    ],
  });

  it("totals completed jobs by local job date, period to date", () => {
    expect(k.today).toBe("2026-11-09");
    expect(k.revenueCents.month).toBe(75000);
    expect(k.revenueCents.week).toBe(30000);
    expect(k.revenueCents.quarter).toBe(75000 + 60000 + 99900 + 12300);
    expect(k.jobsCompletedMonth).toBe(2);
    expect(k.avgTicketCentsMonth).toBe(37500);
  });

  it("compares with the same days of last month", () => {
    expect(k.lastMonthToDateCents).toBe(60000);
  });

  it("computes close rate from decided estimates in the last 60 days", () => {
    expect(k.closeRate).toEqual({ won: 2, lost: 1, pct: (2 / 3) * 100 });
  });

  it("counts booked jobs in the next 7 days, skipping canceled ones", () => {
    expect(k.scheduledNext7).toBe(1);
    expect(k.scheduledNext7ValueCents).toBe(41400);
  });

  it("reaches back to last month in January", () => {
    expect(kpiWindowStart("2026-01-15")).toBe("2025-12-01");
    expect(kpiWindowStart("2026-11-09")).toBe("2026-01-01");
  });
});

describe("Depop link import", () => {
  const html = readFileSync(new URL("../fixtures/depop-listing.html", import.meta.url), "utf8");

  it("accepts only Depop product links and normalizes them", () => {
    expect(normalizeDepopUrl("https://www.depop.com/products/xiaowene-carhartt-blue-hooded-active-jacket-e0f0/?ref=share")).toBe(
      "https://www.depop.com/products/xiaowene-carhartt-blue-hooded-active-jacket-e0f0/",
    );
    expect(normalizeDepopUrl("depop.com/products/abc-123")).toBe("https://www.depop.com/products/abc-123/");
    expect(normalizeDepopUrl("https://evil.example/products/abc")).toBeNull();
    expect(normalizeDepopUrl("https://www.depop.com/someshop/")).toBeNull();
    expect(normalizeDepopUrl("not a link")).toBeNull();
  });

  it("reads the real listing's product data", () => {
    const l = parseDepopListing(html, "https://www.depop.com/products/xiaowene-carhartt-blue-hooded-active-jacket-e0f0/")!;
    expect(l.title).toBe("Carhartt Blue Hooded Active Jacket Duck Canvas Zip Up");
    expect(l.brand).toBe("Carhartt");
    expect(l.size).toBe("L");
    expect(l.category).toBe("Outerwear");
    // Priced in GBP, so no dollar price is invented.
    expect(l.currency).toBe("GBP");
    expect(l.listPriceCents).toBeNull();
  });

  it("uses a USD price as the list price", () => {
    const usd = html.replace('"priceCurrency": "GBP"', '"priceCurrency": "USD"').replace('"price": "90.00"', '"price": "64.99"');
    expect(parseDepopListing(usd, "u")!.listPriceCents).toBe(6499);
  });

  it("returns null when there's no product data", () => {
    expect(parseDepopListing("<html><body>Loading…</body></html>", "u")).toBeNull();
  });

  it("suggests a category from the words in the listing", () => {
    expect(suggestCategory("Levi's 501 jeans W32 L30")).toBe("Bottoms");
    expect(suggestCategory("Nike Dunk Low sneakers")).toBe("Shoes");
    expect(suggestCategory("Vintage band tee")).toBe("Tops");
    expect(suggestCategory("Mystery item")).toBeNull();
  });
});
