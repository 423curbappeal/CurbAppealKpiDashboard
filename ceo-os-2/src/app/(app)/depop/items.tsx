"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, BadgeDollarSign, Link2, PenLine, Plus, Tag, Trash2, Zap } from "lucide-react";
import { createDepopItem, importDepopListing, markDepopSold, removeDepopItem, restoreDepopItem, unmarkDepopSold, updateDepopItem } from "@/server/actions";
import { Sheet, SheetOption, useAction } from "@/components/feedback";
import { Badge, buttonClass, Card, cx, EmptyState, SectionTitle } from "@/components/ui";
import { estimateFeesCents, formatCents, parseMoneyToCents, STALE_AFTER_DAYS } from "@/lib/depop";
import type { DepopRow } from "@/server/data";

const DEFAULT_CATEGORIES = ["Tops", "Bottoms", "Outerwear", "Dresses", "Shoes", "Accessories", "Vintage"];
const LAST_CATEGORY_KEY = "ceo-os.depop.last-category";

/** The last category used, kept on this device only as a convenience. */
function readLastCategory(): string {
  try {
    return window.localStorage.getItem(LAST_CATEGORY_KEY) ?? "";
  } catch {
    return "";
  }
}
function saveLastCategory(c: string) {
  try {
    if (c) window.localStorage.setItem(LAST_CATEGORY_KEY, c);
  } catch {
    // Private mode or storage disabled: nothing to remember.
  }
}

const field = "h-14 w-full rounded-2xl border border-line bg-surface px-4 outline-none focus:border-accent/60";
const money = (cents: number | null | undefined) => (cents == null ? "" : (cents / 100).toFixed(2).replace(/\.00$/, ""));
const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/* ── Add ─────────────────────────────────────────────────────────────────── */

export function AddItemButton({ today, categories, variant = "link", autoOpen = false }: { today: string; categories: string[]; variant?: "link" | "button"; autoOpen?: boolean }) {
  const [open, setOpen] = useState(autoOpen);
  const router = useRouter();
  // Opened from the home-screen shortcut: once closed, drop ?add=1 so a refresh doesn't reopen it.
  const close = () => {
    setOpen(false);
    if (autoOpen) router.replace("/depop", { scroll: false });
  };
  return (
    <>
      {variant === "link" ? (
        <button onClick={() => setOpen(true)} className={buttonClass("primary", "sm")} aria-label="Add a Depop item">
          <Plus size={16} /> Add
        </button>
      ) : (
        <button onClick={() => setOpen(true)} className={buttonClass("primary", "md")}>
          <Plus size={18} /> Add an item
        </button>
      )}
      <Sheet open={open} onClose={close} title="New item">
        {open && <ItemForm today={today} categories={categories} onDone={close} />}
      </Sheet>
    </>
  );
}

/* ── Shared item form (add + edit) ───────────────────────────────────────── */

function ItemForm({ today, categories, item, onDone }: { today: string; categories: string[]; item?: DepopRow; onDone: () => void }) {
  const { run, pending } = useAction();
  const [title, setTitle] = useState(item?.title ?? "");
  const [category, setCategory] = useState(() => item?.category ?? (typeof window === "undefined" ? "" : readLastCategory()));
  const [link, setLink] = useState("");
  const [importNote, setImportNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [added, setAdded] = useState(0);
  const [brand, setBrand] = useState(item?.brand ?? "");
  const [size, setSize] = useState(item?.size ?? "");
  const [cost, setCost] = useState(money(item?.costCents));
  const [listPrice, setListPrice] = useState(money(item?.listPriceCents));
  const [listedOn, setListedOn] = useState(item?.listedOn ?? today);
  const [isSold, setIsSold] = useState(Boolean(item?.soldOn));
  const [soldOn, setSoldOn] = useState(item?.soldOn ?? today);
  const [salePrice, setSalePrice] = useState(money(item?.salePriceCents));
  const [fees, setFees] = useState(item?.feesEstimated ? "" : money(item?.soldOn ? item.feesCents : null));
  const [shipping, setShipping] = useState(item?.soldOn ? money(item.shippingCents || null) : "");
  const [notes, setNotes] = useState(item?.notes ?? "");

  const chips = [...new Set([...categories, ...DEFAULT_CATEGORIES])].slice(0, 10);
  const moneyOk = [cost, listPrice, ...(isSold ? [salePrice, fees, shipping] : [])].every((v) => v === "" || parseMoneyToCents(v) !== null);
  const canSave = title.trim() && moneyOk && (!isSold || parseMoneyToCents(salePrice) !== null);

  const reset = () => {
    setTitle("");
    setBrand("");
    setSize("");
    setCost("");
    setListPrice("");
    setLink("");
    setImportNote(null);
    setIsSold(false);
    setSalePrice("");
    setFees("");
    setShipping("");
    setNotes("");
    requestAnimationFrame(() => document.getElementById("depop-title")?.focus());
  };

  const doImport = async () => {
    setImporting(true);
    setImportNote(null);
    // Called directly (not through run) so a failure shows once, inline, instead of also as a toast.
    const r = await importDepopListing(link).catch(() => null);
    setImporting(false);
    if (!r) return setImportNote({ tone: "error", text: "Couldn't reach CEO OS. Check your connection and try again." });
    if (!r.ok) return setImportNote({ tone: "error", text: r.error });
    const d = r.data!;
    setTitle(d.title);
    if (d.brand) setBrand(d.brand);
    if (d.size) setSize(d.size);
    if (d.category) setCategory(d.category);
    if (d.listPriceCents != null) setListPrice(money(d.listPriceCents));
    setNotes((n) => n || d.url);
    setImportNote({
      tone: "ok",
      text: d.listPriceCents == null && d.currency && d.currency !== "USD" ? `Filled in. Price is in ${d.currency}, so add your list price in dollars.` : "Filled in from Depop. Add what you paid.",
    });
    requestAnimationFrame(() => document.getElementById("depop-cost")?.focus());
  };

  const submit = async (another: boolean) => {
    const payload = {
          title,
          category: category || null,
          brand: brand || null,
          size: size || null,
          costCents: parseMoneyToCents(cost) ?? 0,
          listPriceCents: parseMoneyToCents(listPrice),
          listedOn,
          soldOn: isSold ? soldOn : null,
          salePriceCents: isSold ? parseMoneyToCents(salePrice) : null,
          feesCents: isSold ? parseMoneyToCents(fees) : null,
          shippingCents: isSold ? (parseMoneyToCents(shipping) ?? 0) : 0,
          notes: notes || null,
        };
    const r = await run(() => (item ? updateDepopItem(item.id, payload) : createDepopItem(payload)));
    if (!r?.ok) return;
    if (!item) saveLastCategory(category);
    if (another) {
      setAdded((n) => n + 1);
      reset();
    } else onDone();
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit(false);
      }}
    >
      {!item && (
        <div className="rounded-2xl border border-dashed border-line-strong p-3">
          <div className="flex gap-2">
            <div className="flex h-12 min-w-0 flex-1 items-center gap-2 rounded-xl bg-surface px-3">
              <Link2 size={16} className="shrink-0 text-faint" />
              <input
                id="depop-link"
                type="url"
                inputMode="url"
                aria-label="Depop listing link"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (link.trim()) void doImport();
                  }
                }}
                placeholder="Paste a Depop listing link"
                className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none"
              />
            </div>
            <button type="button" onClick={() => void doImport()} disabled={!link.trim() || importing} className={buttonClass("secondary", "md")}>
              {importing ? "Reading…" : "Fill in"}
            </button>
          </div>
          {importNote && <p className={cx("mt-2 px-1 text-[13px]", importNote.tone === "error" ? "text-warn" : "text-good")}>{importNote.text}</p>}
          {added > 0 && !importNote && <p className="mt-2 px-1 text-[13px] text-good">{added} added. Next item.</p>}
        </div>
      )}

      <Field label="Item">
        <input id="depop-title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Vintage Carhartt jacket" className={field} />
      </Field>

      <div>
        <span className="mb-1.5 block px-1 text-[13px] text-muted">Category</span>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(category === c ? "" : c)}
              aria-pressed={category === c}
              className={cx("h-9 rounded-full border px-3.5 text-[14px] font-medium transition active:scale-95", category === c ? "border-accent/40 bg-accent/15 text-accent" : "border-line bg-surface text-muted")}
            >
              {c}
            </button>
          ))}
        </div>
        <input id="depop-category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Or type a category" aria-label="Category" className={cx(field, "mt-2 h-12")} />
      </div>

      <div className="flex gap-2">
        <Field label="Brand" className="flex-1">
          <input id="depop-brand" value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Optional" className={field} />
        </Field>
        <Field label="Size" className="w-28">
          <input id="depop-size" value={size} onChange={(e) => setSize(e.target.value)} placeholder="M" className={field} />
        </Field>
      </div>

      <div className="flex gap-2">
        <MoneyField id="depop-cost" label="You paid" value={cost} onChange={setCost} />
        <MoneyField id="depop-list" label="List price" value={listPrice} onChange={setListPrice} />
      </div>

      <Field label="Listed on">
        <input id="depop-listed" type="date" required value={listedOn} max={today} onChange={(e) => setListedOn(e.target.value)} className={field} />
      </Field>

      <label className="flex min-h-12 items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-4">
        <span className="text-[15px] font-medium">Already sold</span>
        <input id="depop-is-sold" type="checkbox" checked={isSold} onChange={(e) => setIsSold(e.target.checked)} className="size-5 accent-[var(--color-accent)]" />
      </label>

      {isSold && <SaleFields today={today} listedOn={listedOn} soldOn={soldOn} setSoldOn={setSoldOn} salePrice={salePrice} setSalePrice={setSalePrice} fees={fees} setFees={setFees} shipping={shipping} setShipping={setShipping} idPrefix="depop-form" />}

      <Field label="Notes">
        <input id="depop-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional: where you sourced it, flaws…" className={field} />
      </Field>

      <button className={cx(buttonClass("primary", "lg"), "w-full")} disabled={pending || !canSave}>
        {item ? "Save changes" : isSold ? "Log sale" : "Add listing"}
      </button>
      {!item && (
        <button type="button" onClick={() => void submit(true)} className={cx(buttonClass("ghost", "md"), "w-full")} disabled={pending || !canSave}>
          Save and add another
        </button>
      )}
    </form>
  );
}

function SaleFields(p: {
  today: string;
  listedOn: string;
  soldOn: string;
  setSoldOn: (v: string) => void;
  salePrice: string;
  setSalePrice: (v: string) => void;
  fees: string;
  setFees: (v: string) => void;
  shipping: string;
  setShipping: (v: string) => void;
  idPrefix: string;
}) {
  const sale = parseMoneyToCents(p.salePrice);
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <MoneyField id={`${p.idPrefix}-sale`} label="Sold for" value={p.salePrice} onChange={p.setSalePrice} required autoFocus />
        <Field label="Sold on" className="flex-1">
          <input id={`${p.idPrefix}-sold-on`} type="date" required value={p.soldOn} min={p.listedOn} max={p.today} onChange={(e) => p.setSoldOn(e.target.value)} className={field} />
        </Field>
      </div>
      <div className="flex gap-2">
        <MoneyField id={`${p.idPrefix}-fees`} label="Fees" value={p.fees} onChange={p.setFees} placeholder={sale ? `≈ ${money(estimateFeesCents(sale))}` : "Auto"} />
        <MoneyField id={`${p.idPrefix}-ship`} label="Shipping you paid" value={p.shipping} onChange={p.setShipping} placeholder="0" />
      </div>
      {p.fees === "" && <p className="px-1 text-[12px] text-faint">Leave fees blank to use the estimate (3.3% + $0.45).</p>}
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1.5 block px-1 text-[13px] text-muted">{label}</span>
      {children}
    </label>
  );
}

function MoneyField({ id, label, value, onChange, placeholder = "0", required, autoFocus }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; required?: boolean; autoFocus?: boolean }) {
  const bad = value !== "" && parseMoneyToCents(value) === null;
  return (
    <Field label={label} className="flex-1">
      <div className={cx("flex h-14 items-center rounded-2xl border bg-surface px-4 focus-within:border-accent/60", bad ? "border-bad/60" : "border-line")}>
        <span className="mr-1 text-muted">$</span>
        <input
          id={id}
          inputMode="decimal"
          required={required}
          data-autofocus={autoFocus ? "" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder={placeholder}
          className="h-full w-full bg-transparent tabular outline-none"
        />
      </div>
    </Field>
  );
}

/* ── Lists ───────────────────────────────────────────────────────────────── */

export function ItemLists({ active, sold, today, categories }: { active: DepopRow[]; sold: DepopRow[]; today: string; categories: string[] }) {
  const [tab, setTab] = useState<"active" | "sold">("active");
  const rows = tab === "active" ? active : sold;
  return (
    <>
      <SectionTitle>Items</SectionTitle>
      <div role="tablist" aria-label="Item status" className="mb-2 grid grid-cols-2 gap-1 rounded-full border border-line bg-surface p-1">
        {(["active", "sold"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cx("h-10 rounded-full text-[14px] font-semibold transition", tab === t ? "bg-raised text-ink" : "text-muted")}
          >
            {t === "active" ? `Active · ${active.length}` : `Sold · ${sold.length}`}
          </button>
        ))}
      </div>
      <Card className="divide-y divide-line overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title={tab === "active" ? "Nothing listed right now" : "No sales yet"} body={tab === "active" ? "Add a listing with the Add button." : "Tap an active item and choose Mark sold."} />
        ) : (
          rows.map((r) => <ItemRow key={r.id} item={r} today={today} categories={categories} />)
        )}
      </Card>
    </>
  );
}

function ItemRow({ item, today, categories }: { item: DepopRow; today: string; categories: string[] }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "sell" | "edit">("menu");
  const stale = !item.soldOn && item.daysListed > STALE_AFTER_DAYS;
  const meta = [item.category, item.brand, item.size].filter(Boolean).join(" · ");
  const close = () => {
    setOpen(false);
    setMode("menu");
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="flex w-full items-center gap-3 px-4 py-3.5 text-left active:bg-raised">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[16px] text-ink">{item.title}</p>
          <p className="mt-0.5 truncate text-[13px] text-faint">
            {meta || "No category"}
            {item.soldOn ? ` · sold ${shortDate(item.soldOn)}` : ` · listed ${shortDate(item.listedOn)}`}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {item.soldOn ? (
            <>
              <span className="text-[15px] font-semibold tabular">{formatCents(item.salePriceCents ?? 0, { exact: true })}</span>
              <span className={cx("text-[12px] tabular", (item.profitCents ?? 0) < 0 ? "text-bad" : "text-good")}>
                {formatCents(item.profitCents ?? 0, { exact: true })} profit
              </span>
            </>
          ) : (
            <>
              <span className="text-[15px] font-semibold tabular">{item.listPriceCents != null ? formatCents(item.listPriceCents, { exact: true }) : "—"}</span>
              {stale ? <Badge tone="warn">{item.daysListed} days</Badge> : <span className="text-[12px] text-faint tabular">{item.daysListed}d listed</span>}
            </>
          )}
        </div>
      </button>

      <Sheet open={open} onClose={close} title={mode === "sell" ? "Mark sold" : mode === "edit" ? "Edit item" : item.title}>
        {mode === "menu" && <ItemMenu item={item} today={today} onSell={() => setMode("sell")} onEdit={() => setMode("edit")} onDone={close} />}
        {mode === "sell" && <SellForm item={item} today={today} onDone={close} />}
        {mode === "edit" && <ItemForm item={item} today={today} categories={categories} onDone={close} />}
      </Sheet>
    </>
  );
}

function ItemMenu({ item, today, onSell, onEdit, onDone }: { item: DepopRow; today: string; onSell: () => void; onEdit: () => void; onDone: () => void }) {
  const { run } = useAction();
  return (
    <>
      <dl className="mb-4 grid grid-cols-3 gap-2 text-center">
        <Stat label="Paid" value={formatCents(item.costCents, { exact: true })} />
        {item.soldOn ? (
          <>
            <Stat label="Sold for" value={formatCents(item.salePriceCents ?? 0, { exact: true })} />
            <Stat label="Profit" value={formatCents(item.profitCents ?? 0, { exact: true })} tone={(item.profitCents ?? 0) < 0 ? "bad" : "good"} />
          </>
        ) : (
          <>
            <Stat label="Listed at" value={item.listPriceCents != null ? formatCents(item.listPriceCents, { exact: true }) : "—"} />
            <Stat label="Listed" value={`${item.daysListed}d`} />
          </>
        )}
      </dl>
      {item.soldOn && (
        <p className="-mt-2 mb-4 text-center text-[12px] text-faint">
          Fees {formatCents(item.feesShownCents, { exact: true })}
          {item.feesEstimated ? " (estimated)" : ""} · shipping {formatCents(item.shippingCents, { exact: true })} · sold in {item.daysToSell ?? 0} days
        </p>
      )}
      <div className="-mx-2">
        {!item.soldOn ? (
          <>
            {item.listPriceCents != null && (
              <SheetOption
                icon={<Zap size={18} />}
                label={`Sold at ${formatCents(item.listPriceCents, { exact: true })} today`}
                detail="One tap. Fees estimated, no shipping"
                onClick={async () => {
                  const r = await run(() => markDepopSold(item.id, { soldOn: today, salePriceCents: item.listPriceCents!, feesCents: null, shippingCents: 0 }), {
                    undo: () => () => unmarkDepopSold(item.id),
                  });
                  if (r?.ok) onDone();
                }}
              />
            )}
            <SheetOption icon={<BadgeDollarSign size={18} />} label="Mark sold" detail="Enter price, fees and shipping" onClick={onSell} />
          </>
        ) : (
          <SheetOption
            icon={<ArchiveRestore size={18} />}
            label="Move back to active"
            detail="If the sale fell through"
            onClick={async () => {
              const r = await run(() => unmarkDepopSold(item.id));
              if (r?.ok) onDone();
            }}
          />
        )}
        <SheetOption icon={<PenLine size={18} />} label="Edit details" onClick={onEdit} />
        <SheetOption
          icon={<Trash2 size={18} />}
          label="Remove item"
          tone="danger"
          onClick={async () => {
            const r = await run(() => removeDepopItem(item.id), { undo: () => () => restoreDepopItem(item.id) });
            if (r?.ok) onDone();
          }}
        />
      </div>
    </>
  );
}

function SellForm({ item, today, onDone }: { item: DepopRow; today: string; onDone: () => void }) {
  const { run, pending } = useAction();
  const [soldOn, setSoldOn] = useState(today < item.listedOn ? item.listedOn : today);
  const [salePrice, setSalePrice] = useState(money(item.listPriceCents));
  const [fees, setFees] = useState("");
  const [shipping, setShipping] = useState("");
  const sale = parseMoneyToCents(salePrice);
  const ok = sale !== null && [fees, shipping].every((v) => v === "" || parseMoneyToCents(v) !== null);
  const preview = sale !== null ? sale - item.costCents - (parseMoneyToCents(fees) ?? estimateFeesCents(sale)) - (parseMoneyToCents(shipping) ?? 0) : null;

  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (sale === null) return;
        const r = await run(
          () => markDepopSold(item.id, { soldOn, salePriceCents: sale, feesCents: parseMoneyToCents(fees), shippingCents: parseMoneyToCents(shipping) ?? 0 }),
          { undo: () => () => unmarkDepopSold(item.id) },
        );
        if (r?.ok) onDone();
      }}
    >
      <SaleFields today={today} listedOn={item.listedOn} soldOn={soldOn} setSoldOn={setSoldOn} salePrice={salePrice} setSalePrice={setSalePrice} fees={fees} setFees={setFees} shipping={shipping} setShipping={setShipping} idPrefix="depop-sell" />
      {preview !== null && (
        <div className="flex items-center justify-between rounded-2xl bg-white/[0.04] px-4 py-3">
          <span className="flex items-center gap-2 text-[14px] text-muted">
            <Tag size={15} /> Profit on this item
          </span>
          <span className={cx("text-[17px] font-semibold tabular", preview < 0 ? "text-bad" : "text-good")}>{formatCents(preview, { exact: true })}</span>
        </div>
      )}
      <button className={cx(buttonClass("primary", "lg"), "w-full")} disabled={pending || !ok}>
        Mark sold
      </button>
    </form>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-2xl bg-white/[0.04] px-2 py-3">
      <dt className="text-[12px] text-faint">{label}</dt>
      <dd className={cx("mt-0.5 text-[16px] font-semibold tabular", tone === "good" && "text-good", tone === "bad" && "text-bad")}>{value}</dd>
    </div>
  );
}
