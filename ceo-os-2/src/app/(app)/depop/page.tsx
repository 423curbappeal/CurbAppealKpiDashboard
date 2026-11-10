import Link from "next/link";
import { Clock, ShoppingBag } from "lucide-react";
import { Badge, Card, cx, EmptyState, Screen, ScreenHeader, SectionTitle } from "@/components/ui";
import { formatCents } from "@/lib/depop";
import { requireContext } from "@/server/context";
import { loadDepop } from "@/server/data";
import { AddItemButton, ItemLists } from "./items";

export const metadata = { title: "Depop" };

export default async function DepopPage({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const autoOpen = (await searchParams).add === "1";
  const ctx = await requireContext();
  const { today, stats: s, active, sold, categories, goals } = await loadDepop(ctx);
  const maxMonth = Math.max(1, ...s.months.map((m) => Math.max(m.revenueCents, m.profitCents)));
  const maxCat = Math.max(1, ...s.categories.map((c) => Math.max(0, c.profitCents)));

  return (
    <Screen>
      <ScreenHeader eyebrow="Shop" title="Depop" trailing={<AddItemButton today={today} categories={categories} autoOpen={autoOpen} />} />

      {!s.hasItems ? (
        <Card>
          <EmptyState
            icon={<ShoppingBag size={20} />}
            title="Log your first item"
            body="Add what you list and what you paid for it, then tap Sold when it sells. Profit, margin and days-to-sell work themselves out."
            action={<AddItemButton today={today} categories={categories} variant="button" />}
          />
        </Card>
      ) : (
        <>
          {/* Headline */}
          <Card className="animate-rise p-5">
            <p className="text-[13px] font-medium tracking-wide text-faint uppercase">Profit · last 30 days</p>
            <div className="mt-1 flex items-baseline gap-3">
              <span className={cx("font-display text-[40px] leading-none font-semibold tracking-[-0.02em] tabular", s.last30.profitCents < 0 && "text-bad")}>
                {formatCents(s.last30.profitCents)}
              </span>
              <Change value={s.change.profitPct} unit="%" />
            </div>
            <p className="mt-2 text-[14px] text-muted">
              {formatCents(s.last30.revenueCents)} in sales from {s.last30.sold} {s.last30.sold === 1 ? "item" : "items"}
              {s.last30.feesEstimated && <span className="text-faint"> · some fees estimated</span>}
            </p>
            {goals.map((g) => (
              <Link key={g.id} href="/growth" className="mt-4 block border-t border-line pt-3">
                <div className="flex items-baseline justify-between gap-3 text-[13px]">
                  <span className="truncate text-muted">{g.title}</span>
                  <span className="shrink-0 tabular text-ink">
                    {formatCents(Math.round(g.current * 100))} <span className="text-faint">of {formatCents(Math.round(g.target * 100))} this {g.period}</span>
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                  <div className={cx("h-full rounded-full", g.percent >= 100 ? "bg-good" : "bg-accent")} style={{ width: `${Math.max(2, g.percent)}%` }} />
                </div>
              </Link>
            ))}
          </Card>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <Kpi label="Items sold" value={String(s.last30.sold)} change={<Change value={s.change.soldPct} unit="%" />} />
            <Kpi label="Avg sale" value={s.last30.avgSaleCents === null ? "—" : formatCents(s.last30.avgSaleCents, { exact: true })} change={<Change value={s.change.avgSalePct} unit="%" />} />
            <Kpi label="Margin" value={s.last30.marginPct === null ? "—" : `${Math.round(s.last30.marginPct)}%`} change={<Change value={s.change.marginPts} unit=" pts" />} />
            <Kpi
              label="Days to sell"
              value={s.last30.avgDaysToSell === null ? "—" : s.last30.avgDaysToSell.toFixed(0)}
              change={<Change value={s.change.avgDaysDelta} unit=" d" lowerIsBetter />}
            />
            <Kpi label="Sell-through" value={s.sellThroughPct === null ? "—" : `${Math.round(s.sellThroughPct)}%`} detail="sold ÷ (sold + listed)" />
            <Kpi label="Active listings" value={String(s.active)} detail={`${formatCents(s.inventoryCostCents)} in stock`} />
          </div>
          <p className="mt-2 px-1 text-[12px] text-faint">Changes compare with the 30 days before.</p>

          {s.stale > 0 && (
            <Card className="mt-4 flex items-center gap-3 border-warn/25 bg-warn/[0.06] p-4">
              <Clock size={18} className="shrink-0 text-warn" />
              <p className="text-[14px] leading-snug text-ink">
                {s.stale} {s.stale === 1 ? "listing has" : "listings have"} been up more than 60 days. They're at the top of Active below.
              </p>
            </Card>
          )}

          {/* Monthly */}
          <SectionTitle
            action={
              <span className="flex items-center gap-3 text-[12px] text-faint">
                <Legend className="bg-white/25" label="Sales" />
                <Legend className="bg-accent" label="Profit" />
              </span>
            }
          >
            Last 6 months
          </SectionTitle>
          <Card className="p-4">
            <div className="flex h-32 items-end gap-3" role="img" aria-label="Monthly Depop sales and profit for the last 6 months">
              {s.months.map((m, i) => (
                <div key={m.month} className="flex h-full flex-1 flex-col justify-end">
                  <div className="flex flex-1 items-end justify-center gap-[3px]">
                    <div className="w-2.5 rounded-full bg-white/25" style={{ height: `${(m.revenueCents / maxMonth) * 100}%`, minHeight: m.revenueCents ? 4 : 0 }} />
                    <div
                      className={cx("w-2.5 rounded-full bg-accent", i === s.months.length - 1 ? "opacity-100" : "opacity-70")}
                      style={{ height: `${(Math.max(0, m.profitCents) / maxMonth) * 100}%`, minHeight: m.profitCents > 0 ? 4 : 0 }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-3 text-center text-[11px] text-faint">
              {s.months.map((m) => (
                <span key={m.month} className="flex-1">
                  {m.label}
                </span>
              ))}
            </div>
            <div className="mt-3 flex gap-3 border-t border-line pt-3 text-center text-[11px] text-muted tabular">
              {s.months.map((m) => (
                <span key={m.month} className="flex-1 truncate">
                  {m.profitCents ? formatCents(m.profitCents) : "—"}
                </span>
              ))}
            </div>
          </Card>

          {/* Categories */}
          {s.categories.length > 0 && (
            <>
              <SectionTitle action={<span className="text-[12px] text-faint">last 90 days</span>}>Best categories</SectionTitle>
              <Card className="divide-y divide-line overflow-hidden">
                {s.categories.slice(0, 6).map((c) => (
                  <div key={c.category} className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-[15px] font-medium">{c.category}</span>
                      <span className="text-[15px] font-semibold tabular">{formatCents(c.profitCents)}</span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, (Math.max(0, c.profitCents) / maxCat) * 100)}%` }} />
                    </div>
                    <p className="mt-1.5 text-[12px] text-faint tabular">
                      {c.sold} sold · {c.marginPct === null ? "—" : `${Math.round(c.marginPct)}%`} margin
                      {c.avgDaysToSell !== null && ` · ${c.avgDaysToSell.toFixed(0)} days to sell`}
                    </p>
                  </div>
                ))}
              </Card>
            </>
          )}

          <ItemLists active={active} sold={sold} today={today} categories={categories} />

          <p className="mt-6 px-1 text-[12px] leading-relaxed text-faint">
            Profit is sale price minus what you paid, fees and any shipping you covered. When you leave fees blank, CEO OS estimates Depop's payment fee (3.3% + $0.45) and marks it as estimated.
          </p>
        </>
      )}
    </Screen>
  );
}

function Kpi({ label, value, change, detail }: { label: string; value: string; change?: React.ReactNode; detail?: string }) {
  return (
    <Card className="p-4">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-1 text-[22px] leading-tight font-semibold tracking-[-0.01em] tabular">{value}</p>
      <div className="mt-1 min-h-[18px] text-[12px] text-faint">{change ?? detail}</div>
    </Card>
  );
}

function Change({ value, unit, lowerIsBetter = false }: { value: number | null; unit: string; lowerIsBetter?: boolean }) {
  if (value === null || !Number.isFinite(value)) return <span className="text-[12px] text-faint">no prior data</span>;
  const rounded = Math.round(value);
  if (rounded === 0) return <Badge>±0{unit}</Badge>;
  const good = lowerIsBetter ? rounded < 0 : rounded > 0;
  return <Badge tone={good ? "good" : "bad"}>{`${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}${unit}`}</Badge>;
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cx("size-2 rounded-full", className)} />
      {label}
    </span>
  );
}
