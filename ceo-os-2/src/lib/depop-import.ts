/**
 * Reads a Depop listing page into item fields. Pure functions, no I/O.
 *
 * Depop product pages carry a schema.org Product block (JSON-LD) in their
 * HTML: name, description, brand, and an offer with price + currency. That
 * structure was checked against a live listing (Nov 2026). Anything we can't
 * find is left blank for the user to fill in; nothing is guessed except a
 * suggested category, which the user sees and can change.
 */

export interface ImportedListing {
  title: string;
  brand: string | null;
  size: string | null;
  category: string | null;
  /** Only set when the listing is priced in USD. */
  listPriceCents: number | null;
  currency: string | null;
  url: string;
}

const DEPOP_HOST = /^(www\.)?depop\.com$/i;

/** Accepts depop.com/products/<slug> links (with or without https://, query or trailing slash). */
export function normalizeDepopUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if (!DEPOP_HOST.test(u.hostname)) return null;
  const m = /^\/products\/([a-z0-9-]+)\/?$/i.exec(u.pathname);
  if (!m) return null;
  return `https://www.depop.com/products/${m[1]!.toLowerCase()}/`;
}

interface LdProduct {
  "@type"?: string | string[];
  name?: string;
  description?: string;
  brand?: { name?: string } | string;
  offers?: { price?: string | number; priceCurrency?: string } | { price?: string | number; priceCurrency?: string }[];
}

function findProduct(html: string): LdProduct | null {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data: unknown = JSON.parse(m[1]!);
      const list = Array.isArray(data) ? data : [data];
      for (const d of list as LdProduct[]) {
        const t = d?.["@type"];
        if (t === "Product" || (Array.isArray(t) && t.includes("Product"))) return d;
      }
    } catch {
      // Not JSON we understand; keep looking.
    }
  }
  return null;
}

const CATEGORY_RULES: [RegExp, string][] = [
  [/\b(jacket|coat|parka|puffer|fleece|vest|gilet|windbreaker|anorak)\b/i, "Outerwear"],
  [/\b(jeans|pants|trousers|shorts|skirt|cargos?|joggers|leggings|overalls)\b/i, "Bottoms"],
  [/\b(dress|gown|romper|jumpsuit)\b/i, "Dresses"],
  [/\b(sneakers?|shoes|boots|trainers|loafers|sandals|heels|dunks|jordans)\b/i, "Shoes"],
  [/\b(bag|purse|tote|backpack|hat|cap|beanie|belt|scarf|sunglasses|wallet|jewel(le)?ry|necklace|ring)\b/i, "Accessories"],
  [/\b(tee|t-shirt|shirt|top|hoodie|sweatshirt|sweater|jumper|crewneck|cardigan|polo|blouse|tank|jersey|flannel)\b/i, "Tops"],
];

export function suggestCategory(text: string): string | null {
  for (const [re, cat] of CATEGORY_RULES) if (re.test(text)) return cat;
  return null;
}

const SIZE = /\bsize[:\s]+((?:xxs|xs|s|m|l|xl|xxl|xxxl|[0-9]{1,2}(?:\.[05])?(?:\s?[xX]\s?[0-9]{2})?|w[0-9]{2}(?:\s?l[0-9]{2})?)(?:\/[a-z0-9]+)?)\b/i;

export function parseDepopListing(html: string, url: string): ImportedListing | null {
  const p = findProduct(html);
  if (!p?.name) return null;
  const description = (p.description ?? "").trim();
  // Depop truncates long names with "..."; the description usually starts with the full name.
  let title = p.name.trim();
  if (title.endsWith("...")) {
    const firstLine = description.split("\n")[0]?.trim() ?? "";
    const stem = title.slice(0, -3).trim();
    title = firstLine.toLowerCase().startsWith(stem.toLowerCase()) ? firstLine : stem;
  }
  title = title.replace(/\s*\bsize[:\s]+\S+\s*$/i, "").slice(0, 160).trim() || p.name.slice(0, 160);
  const brandRaw = typeof p.brand === "string" ? p.brand : p.brand?.name;
  const brand = brandRaw && !/^(other|unbranded|n\/a)$/i.test(brandRaw.trim()) ? brandRaw.trim().slice(0, 80) : null;
  const offer = Array.isArray(p.offers) ? p.offers[0] : p.offers;
  const currency = offer?.priceCurrency?.toUpperCase() ?? null;
  const price = offer?.price != null ? Number(offer.price) : NaN;
  const size = SIZE.exec(`${p.name}\n${description}`)?.[1]?.toUpperCase() ?? null;
  return {
    title,
    brand,
    size,
    category: suggestCategory(`${p.name} ${description}`),
    listPriceCents: currency === "USD" && Number.isFinite(price) ? Math.round(price * 100) : null,
    currency,
    url,
  };
}
