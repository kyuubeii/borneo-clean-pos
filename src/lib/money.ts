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

/**
 * Put an invoice's status back in step with the payments against it. Call this after
 * anything that moves either side — a price correction, a deleted payment, a refund.
 * VOID and DRAFT are deliberate states set by a person, so they are left alone.
 *
 * This is the only copy. There used to be a second, private one in finance.ts that
 * left out the OVERDUE branch, so an invoice's status depended on which path last
 * touched it: recording a payment could leave it OVERDUE, deleting one reset it to
 * SENT and it quietly dropped off the chase list.
 *
 * OVERDUE is only reached from an unpaid invoice. A part-paid invoice past its due
 * date stays PARTIAL, which is what both old copies did — preserved deliberately so
 * fixing the divergence does not also change who gets chased.
 */
export async function syncInvoiceStatus(db: any, invoiceId: string) {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId }, include: { items: true, payments: true } });
  if (!inv || inv.status === "VOID" || inv.status === "DRAFT") return inv;
  const { total } = totals(inv.items, inv.discountCents, inv.taxRateBp);
  const paid = inv.payments.reduce((a: number, p: any) => a + (p.isRefund ? -p.amountCents : p.amountCents), 0);
  const status = paid <= 0 ? (inv.dueAt && inv.dueAt < new Date() ? "OVERDUE" : "SENT")
    : paid >= total ? "PAID" : "PARTIAL";
  if (status === inv.status) return inv;
  return db.invoice.update({ where: { id: invoiceId }, data: { status } });
}

/** What has actually been received, net of refunds. Never the same as the balance. */
export const netCollected = (payments: { amountCents: number; isRefund: boolean }[]) =>
  payments.reduce((a, p) => a + (p.isRefund ? -p.amountCents : p.amountCents), 0);
