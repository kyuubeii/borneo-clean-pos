/** All money is stored as integer cents (MYR). Never use floats for money. */
export const toCents = (v: number | string): number => {
  const n = typeof v === "string" ? parseFloat(v.replace(/[^0-9.\-]/g, "")) : v;
  if (!isFinite(n)) return 0;
  return Math.round(n * 100);
};
export const fromCents = (c: number): number => c / 100;
export const fmt = (cents: number, withSymbol = true): string => {
  const neg = cents < 0;
  const s = (Math.abs(cents) / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${neg ? "-" : ""}${withSymbol ? "RM " : ""}${s}`;
};
/** Line subtotal, then discount, then tax (basis points). Returns integer cents. */
export function totals(items: { qty: number; priceCents: number }[], discountCents = 0, taxRateBp = 0) {
  const subtotal = items.reduce((a, i) => a + i.qty * i.priceCents, 0);
  const afterDiscount = Math.max(0, subtotal - discountCents);
  const tax = Math.round((afterDiscount * taxRateBp) / 10000);
  return { subtotal, discount: discountCents, tax, total: afterDiscount + tax };
}
