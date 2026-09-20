"use client";
import Link from "next/link";
import CustomerPicker from "@/components/CustomerPicker";
import { useState, useEffect } from "react";
import { useT } from "@/components/I18nProvider";
import { useAction, Badge, Money, Empty, Modal, Field, callAction, toast, ConfirmDelete, humanError, LoadError } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { useCan, ADMIN_UP } from "@/components/UserProvider";
import { fmtDate, toInput } from "@/lib/dates";
import { toCents } from "@/lib/money";

export default function Quotes() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [convert, setConvert] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const manage = useCan(ADMIN_UP);
  const { data, loading, error, refresh } = useAction<any[]>("quotes.list", { limit: 100 });

  async function setStatus(q: any, status: string) {
    try { await callAction("quotes.updateStatus", { quoteId: q.id, status }); toast("Quote updated"); refresh(); }
    catch (e: any) { toast(humanError(e.message), "err"); }
  }

  /**
   * quotes.list returns a summary, but editing needs the line items, so the full
   * record is fetched before the form opens.
   */
  async function openEdit(q: any) {
    try { setEditing(await callAction("quotes.get", { quoteId: q.id })); }
    catch (e: any) { toast(humanError(e.message), "err"); }
  }

  return (
    <div>
      <PageHeader title={t("nav.quotes")} subtitle={`${data?.length ?? 0} ${t("common.shown")}`}
        actions={<button onClick={() => setOpen(true)} className="btn-primary btn-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          {t("common.new")}</button>} />

      <LoadError error={error} onRetry={refresh} />
      <div className="card overflow-hidden">
        {loading ? <p className="p-4 text-sm text-ink-400">{t("common.loading")}</p>
        : !data?.length ? <Empty text={t("common.empty")} />
        : <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-ink-100 bg-ink-50/50">
                <tr><th className="th">Ref</th><th className="th">{t("common.customer")}</th>
                  <th className="th">{t("inv.issued")}</th><th className="th">Valid until</th>
                  <th className="th text-right">{t("common.total")}</th><th className="th">{t("common.status")}</th>
                  <th className="th text-right">{t("common.actions")}</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {data.map((q) => (
                  <tr key={q.id}>
                    <td className="td whitespace-nowrap font-medium text-ink-900">{q.ref}</td>
                    <td className="td font-medium text-ink-800">{q.customer}</td>
                    <td className="td whitespace-nowrap text-ink-500">{fmtDate(new Date(q.issuedAt))}</td>
                    <td className="td whitespace-nowrap text-ink-500">{q.validUntil ? fmtDate(new Date(q.validUntil)) : "—"}</td>
                    <td className="td text-right font-medium"><Money cents={q.total} /></td>
                    <td className="td"><Badge status={q.status} /></td>
                    <td className="td text-right">
                      <div className="flex justify-end gap-1">
                        {!q.convertedBookingId && q.status === "DRAFT" && <button onClick={() => setStatus(q, "SENT")} className="btn-ghost btn-sm">Mark sent</button>}
                        {!q.convertedBookingId && q.status === "SENT" && <>
                          <button onClick={() => setStatus(q, "ACCEPTED")} className="btn-ghost btn-sm text-emerald-600">Accept</button>
                          <button onClick={() => setStatus(q, "DECLINED")} className="btn-ghost btn-sm text-red-600">Decline</button>
                        </>}
                        {!q.convertedBookingId && q.status === "ACCEPTED" && <button onClick={() => setConvert(q)} className="btn-outline btn-sm">Book it</button>}
                        {q.convertedBookingId && <Link className="btn-outline btn-sm" href={`/bookings/${q.convertedBookingId}`}>View booking</Link>}
                        <button className="btn-ghost btn-sm" onClick={async () => { try { setPreview(await callAction("quotes.get", { quoteId: q.id })); } catch (e: any) { toast(e.message, "err"); } }}>Preview</button>
                        {manage && !q.convertedBookingId && (
                          <>
                            <button onClick={() => openEdit(q)} className="btn-ghost btn-sm">{t("common.edit")}</button>
                            <button onClick={() => setDeleting(q)} title="Delete permanently"
                              className="rounded-lg border border-ink-200 p-1.5 text-ink-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </div>

      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview?.ref ?? "Quote"} wide>
        {preview && <div className="space-y-3"><p className="font-semibold">{preview.customer.name}</p>
          <p className="text-sm">Valid until: {preview.validUntil ? fmtDate(new Date(preview.validUntil)) : "—"}</p>
          {preview.items.map((i: any) => <div key={i.id} className="flex justify-between gap-3 text-sm"><span>{i.name} × {i.qty}</span><Money cents={i.qty * i.priceCents} /></div>)}
          <p>Discount: <Money cents={preview.discount} /> · Tax: <Money cents={preview.tax} /></p>
          <p className="font-semibold">Total: <Money cents={preview.total} /></p><p className="whitespace-pre-line text-sm">{preview.notes}</p>
        </div>}
      </Modal>
      <QuoteForm open={open} onClose={() => setOpen(false)} onDone={refresh} />
      <QuoteForm open={!!editing} initial={editing} onClose={() => setEditing(null)} onDone={refresh} />
      <ConvertModal quote={convert} onClose={() => setConvert(null)} onDone={refresh} />

      <ConfirmDelete
        open={!!deleting} onClose={() => setDeleting(null)} onDone={refresh}
        title="Delete quote permanently"
        action="quotes.delete" input={{ quoteId: deleting?.id }}
        confirmText={deleting?.ref} confirmLabel="the quote reference">
        Quote <strong>{deleting?.ref}</strong> for {deleting?.customer} and all its line
        items are removed for good. This cannot be undone.
        <br /><br />
        A quote that has already been turned into a booking cannot be deleted \u2014 cancel
        the booking instead.
      </ConfirmDelete>
    </div>
  );
}

/** Create when `initial` is absent, edit when it is there. */
function QuoteForm({ open, onClose, onDone, initial }: any) {
  const t = useT();
  const [services, setServices] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [items, setItems] = useState<any[]>([{ name: "", qty: 1, price: "" }]);
  const [discount, setDiscount] = useState("");
  const [tax, setTax] = useState("0");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;

    callAction("services.list", {}).then(setServices).catch(() => {});
  }, [open]);

  // Seed from the record being edited, and clear when reused for a new quote.
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setCustomerId(initial.customerId ?? "");
      setItems(initial.items?.length
        ? initial.items.map((i: any) => ({ name: i.name, qty: i.qty, price: (i.priceCents / 100).toFixed(2), serviceId: i.serviceId ?? undefined }))
        : [{ name: "", qty: 1, price: "" }]);
      setDiscount(initial.discountCents ? (initial.discountCents / 100).toFixed(2) : "");
      setTax(String((initial.taxRateBp ?? 0) / 100));
      setNotes(initial.notes ?? "");
    } else {
      setCustomerId(""); setItems([{ name: "", qty: 1, price: "" }]);
      setDiscount(""); setTax("0"); setNotes("");
    }
  }, [open, initial]);

  const subtotal = items.reduce((a, i) => a + (Number(i.qty) || 0) * toCents(i.price || 0), 0);
  const afterDisc = Math.max(0, subtotal - toCents(discount || 0));
  const total = afterDisc + Math.round(afterDisc * (parseFloat(tax || "0") * 100) / 10000);

  const setItem = (n: number, k: string, v: any) => setItems(items.map((it, i) => i === n ? { ...it, [k]: v } : it));

  async function go() {
    if (!customerId) return toast("Choose a customer", "err");
    if (items.some(i => !i.name.trim() || i.price === "" || !Number.isInteger(Number(i.qty)) || Number(i.qty) < 1 || toCents(i.price) < 0)) return toast("Complete every line with a description, quantity and valid price", "err");
    const valid = items;
    if (!valid.length) return toast("Add at least one line item", "err");
    setBusy(true);
    const lines = valid.map((i) => ({ name: i.name, qty: Number(i.qty) || 1, priceCents: toCents(i.price), serviceId: i.serviceId || undefined }));
    try {
      if (initial) {
        // The customer is fixed once a quote exists; quotes.update does not take one.
        await callAction("quotes.update", {
          quoteId: initial.id, items: lines, discountCents: toCents(discount || 0),
          taxRateBp: Math.round(parseFloat(tax || "0") * 100), notes: notes || undefined,
        });
        toast("Quote updated");
      } else {
        await callAction("quotes.create", {
          customerId, discountCents: toCents(discount || 0), taxRateBp: Math.round(parseFloat(tax || "0") * 100),
          notes: notes || undefined, items: lines,
        });
        toast("Quote created");
      }
      onDone(); onClose();
    } catch (e: any) { toast(humanError(e.message), "err"); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? `Edit quote ${initial.ref}` : "New quote"} wide>
      <div className="space-y-3">
        <Field label={t("common.customer")}>
          <CustomerPicker value={customerId} onChange={setCustomerId} disabled={!!initial} />
        </Field>

        <div>
          <p className="label">{t("inv.items")}</p>
          <div className="space-y-2">
            {items.map((it, n) => (
              <div key={n} className="grid grid-cols-2 gap-2 sm:flex">
                <select className="input sm:w-40 shrink-0 text-xs"
                  onChange={(e) => {
                    const s = services.find((x) => x.id === e.target.value);
                    setItems(items.map((x, i) => i === n ? (s ? { ...x, name: s.name, price: (s.priceCents / 100).toFixed(2), serviceId: s.id } : { ...x, serviceId: undefined }) : x));
                  }} value={it.serviceId ?? ""}>
                  <option value="">Custom…</option>
                  {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input className="input flex-1" placeholder="Description" value={it.name} onChange={(e) => setItem(n, "name", e.target.value)} />
                <input className="input w-16 shrink-0 text-center" value={it.qty} onChange={(e) => setItem(n, "qty", e.target.value)} />
                <input className="input w-24 shrink-0 text-right" placeholder="0.00" value={it.price} onChange={(e) => setItem(n, "price", e.target.value)} />
                <button onClick={() => setItems(items.filter((_, i) => i !== n))} disabled={items.length === 1}
                  className="btn-ghost btn-sm shrink-0 text-ink-400 disabled:opacity-30">✕</button>
              </div>
            ))}
          </div>
          <button onClick={() => setItems([...items, { name: "", qty: 1, price: "" }])} className="btn-ghost btn-sm mt-2">+ {t("common.add")} line</button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("inv.discount")} (RM)`}><input className="input" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0.00" /></Field>
          <Field label={`${t("inv.tax")} (%)`}><input className="input" value={tax} onChange={(e) => setTax(e.target.value)} /></Field>
        </div>
        <Field label={`${t("common.notes")} (${t("common.optional")})`}><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

        <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3.5 py-2.5">
          <span className="text-xs text-ink-500">{t("common.total")}</span>
          <span className="text-base font-semibold"><Money cents={total} /></span>
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={go} disabled={busy} className="btn-primary">
            {busy ? t("common.saving") : initial ? t("common.save") : t("common.create")}</button>
        </div>
      </div>
    </Modal>
  );
}

function ConvertModal({ quote, onClose, onDone }: any) {
  const t = useT();
  const [when, setWhen] = useState(toInput(new Date(Date.now() + 86400000)));
  const [busy, setBusy] = useState(false);
  if (!quote) return null;
  async function go() {
    setBusy(true);
    try {
      const r = await callAction("quotes.convertToBooking", { quoteId: quote.id, startAt: new Date(when).toISOString() });
      toast(`Booking ${r.bookingRef} created`); onDone(); onClose();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }
  return (
    <Modal open={!!quote} onClose={onClose} title="Convert quote to booking">
      <div className="space-y-3">
        <p className="text-sm text-ink-600">{quote.ref} · {quote.customer} · <Money cents={quote.total} /></p>
        <Field label="Schedule the visit for"><input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={go} disabled={busy} className="btn-primary">{t("common.create")}</button></div>
      </div>
    </Modal>
  );
}
