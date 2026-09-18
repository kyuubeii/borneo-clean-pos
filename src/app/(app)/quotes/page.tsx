"use client";
import { useState, useEffect } from "react";
import { useT } from "@/components/I18nProvider";
import { useAction, Badge, Money, Empty, Modal, Field, callAction, toast } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { fmtDate, toInput } from "@/lib/dates";
import { toCents } from "@/lib/money";

export default function Quotes() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [convert, setConvert] = useState<any>(null);
  const { data, loading, refresh } = useAction<any[]>("quotes.list", { limit: 100 });

  async function setStatus(q: any, status: string) {
    try { await callAction("quotes.updateStatus", { quoteId: q.id, status }); toast("Quote updated"); refresh(); }
    catch (e: any) { toast(e.message, "err"); }
  }

  return (
    <div>
      <PageHeader title={t("nav.quotes")} subtitle={`${data?.length ?? 0} ${t("common.shown")}`}
        actions={<button onClick={() => setOpen(true)} className="btn-primary btn-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          {t("common.new")}</button>} />

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
                        {q.status === "DRAFT" && <button onClick={() => setStatus(q, "SENT")} className="btn-ghost btn-sm">Send</button>}
                        {q.status === "SENT" && <>
                          <button onClick={() => setStatus(q, "ACCEPTED")} className="btn-ghost btn-sm text-emerald-600">Accept</button>
                          <button onClick={() => setStatus(q, "DECLINED")} className="btn-ghost btn-sm text-red-600">Decline</button>
                        </>}
                        {q.status === "ACCEPTED" && <button onClick={() => setConvert(q)} className="btn-outline btn-sm">Book it</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </div>

      <QuoteForm open={open} onClose={() => setOpen(false)} onDone={refresh} />
      <ConvertModal quote={convert} onClose={() => setConvert(null)} onDone={refresh} />
    </div>
  );
}

function QuoteForm({ open, onClose, onDone }: any) {
  const t = useT();
  const [customers, setCustomers] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [items, setItems] = useState<any[]>([{ name: "", qty: 1, price: "" }]);
  const [discount, setDiscount] = useState("");
  const [tax, setTax] = useState("0");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    callAction("customers.search", { limit: 50 }).then(setCustomers).catch(() => {});
    callAction("services.list", {}).then(setServices).catch(() => {});
  }, [open]);

  const subtotal = items.reduce((a, i) => a + (Number(i.qty) || 0) * toCents(i.price || 0), 0);
  const afterDisc = Math.max(0, subtotal - toCents(discount || 0));
  const total = afterDisc + Math.round(afterDisc * (parseFloat(tax || "0") * 100) / 10000);

  const setItem = (n: number, k: string, v: any) => setItems(items.map((it, i) => i === n ? { ...it, [k]: v } : it));

  async function go() {
    if (!customerId) return toast("Choose a customer", "err");
    const valid = items.filter((i) => i.name.trim() && i.price);
    if (!valid.length) return toast("Add at least one line item", "err");
    setBusy(true);
    try {
      await callAction("quotes.create", {
        customerId, discountCents: toCents(discount || 0), taxRateBp: Math.round(parseFloat(tax || "0") * 100),
        notes: notes || undefined,
        items: valid.map((i) => ({ name: i.name, qty: Number(i.qty) || 1, priceCents: toCents(i.price), serviceId: i.serviceId || undefined })),
      });
      toast("Quote created"); onDone(); onClose();
      setItems([{ name: "", qty: 1, price: "" }]); setCustomerId(""); setDiscount(""); setNotes("");
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="New quote" wide>
      <div className="space-y-3">
        <Field label={t("common.customer")}>
          <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— select —</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>

        <div>
          <p className="label">{t("inv.items")}</p>
          <div className="space-y-2">
            {items.map((it, n) => (
              <div key={n} className="flex gap-2">
                <select className="input w-40 shrink-0 text-xs"
                  onChange={(e) => {
                    const s = services.find((x) => x.id === e.target.value);
                    if (s) setItems(items.map((x, i) => i === n ? { ...x, name: s.name, price: (s.priceCents / 100).toFixed(2), serviceId: s.id } : x));
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
          <button onClick={go} disabled={busy} className="btn-primary">{busy ? t("common.saving") : t("common.create")}</button>
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
