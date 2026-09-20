"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Badge, Money, Empty, Modal, Field, callAction, toast, humanError } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { useCan, ADMIN_UP } from "@/components/UserProvider";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { toCents } from "@/lib/money";

export default function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const { data: inv, loading, refresh } = useAction<any>("invoices.get", { invoiceId: id });
  const biz = useAction<any>("settings.get", {});
  const [pay, setPay] = useState(false);
  const [refund, setRefund] = useState(false);
  const canRefund = useCan(ADMIN_UP);

  if (loading) return <p className="text-sm text-ink-400">{t("common.loading")}</p>;
  if (!inv) return <Empty text="Invoice not found" />;
  const s = biz.data ?? {};

  return (
    <div className="space-y-4">
      <div className="no-print">
        <PageHeader title={inv.ref} subtitle={inv.customer.name} actions={
          <>
            {inv.balance > 0 && inv.status !== "VOID" && (
              <button onClick={() => setPay(true)} className="btn-primary btn-sm">{t("inv.recordPayment")}</button>
            )}
            {canRefund && inv.paid > 0 && inv.status !== "VOID" && (
              <button onClick={() => setRefund(true)} className="btn-outline btn-sm">Refund</button>
            )}
            <button onClick={() => window.print()} className="btn-outline btn-sm">{t("common.print")}</button>
            <Link href="/invoices" className="btn-outline btn-sm">{t("common.back")}</Link>
          </>} />
      </div>

      <div className="card mx-auto max-w-3xl p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-100 pb-5">
          <div>
            <p className="text-lg font-semibold tracking-tight text-ink-900">{s["business.name"] ?? "Borneo Clean Services"}</p>
            <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-ink-500">{s["business.address"]}</p>
            <p className="text-xs text-ink-500">{s["business.phone"]} · {s["business.email"]}</p>
            {s["business.regNo"] && <p className="text-xs text-ink-400">{s["business.regNo"]}</p>}
          </div>
          <div className="text-right">
            <p className="text-2xl font-semibold tracking-tight text-ink-900">INVOICE</p>
            <p className="mt-0.5 text-sm font-medium text-ink-600">{inv.ref}</p>
            <div className="mt-2"><Badge status={inv.status} label={t(`inv.status.${inv.status}`)} /></div>
          </div>
        </div>

        <div className="grid gap-4 py-5 sm:grid-cols-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">Bill to</p>
            <p className="mt-1 text-sm font-medium text-ink-900">{inv.customer.name}</p>
            {inv.customer.company && <p className="text-xs text-ink-500">{inv.customer.company}</p>}
            {inv.customer.email && <p className="text-xs text-ink-500">{inv.customer.email}</p>}
            {inv.customer.phone && <p className="text-xs text-ink-500">{inv.customer.phone}</p>}
          </div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{t("inv.issued")}</p>
            <p className="mt-1 text-sm text-ink-700">{fmtDate(new Date(inv.issuedAt))}</p></div>
          <div><p className="text-[11px] font-semibold uppercase tracking-wide text-ink-400">{t("inv.dueDate")}</p>
            <p className="mt-1 text-sm text-ink-700">{inv.dueAt ? fmtDate(new Date(inv.dueAt)) : "—"}</p></div>
        </div>

        <table className="w-full">
          <thead><tr className="border-y border-ink-100">
            <th className="th">Description</th><th className="th text-center">Qty</th>
            <th className="th text-right">Unit</th><th className="th text-right">{t("common.amount")}</th></tr></thead>
          <tbody className="divide-y divide-ink-50">
            {inv.items.map((i: any) => (
              <tr key={i.id}>
                <td className="td">{i.name}</td>
                <td className="td text-center tabular-nums">{i.qty}</td>
                <td className="td text-right"><Money cents={i.priceCents} /></td>
                <td className="td text-right font-medium"><Money cents={i.qty * i.priceCents} /></td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-5 flex justify-end">
          <dl className="w-full max-w-xs space-y-1.5 text-sm">
            <Line k={t("inv.subtotal")} v={inv.subtotal} />
            {inv.discount > 0 && <Line k={t("inv.discount")} v={-inv.discount} />}
            {inv.tax > 0 && <Line k={`${t("inv.tax")} (${inv.taxRateBp / 100}%)`} v={inv.tax} />}
            <div className="flex justify-between border-t border-ink-100 pt-1.5">
              <dt className="font-semibold">{t("common.total")}</dt>
              <dd className="font-semibold"><Money cents={inv.total} /></dd>
            </div>
            <Line k={t("inv.paid")} v={inv.paid} tone="text-emerald-600" />
            <div className="flex justify-between border-t border-ink-100 pt-1.5">
              <dt className="font-semibold">{t("inv.balance")}</dt>
              <dd className={`text-base font-semibold ${inv.balance > 0 ? "text-amber-600" : "text-emerald-600"}`}><Money cents={inv.balance} /></dd>
            </div>
          </dl>
        </div>

        {s["invoice.footer"] && <p className="mt-6 border-t border-ink-100 pt-4 text-xs text-ink-400">{s["invoice.footer"]}</p>}
      </div>

      {inv.payments.length > 0 && (
        <div className="card mx-auto max-w-3xl">
          <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">{t("nav.payments")}</p></div>
          <div className="divide-y divide-ink-50">
            {inv.payments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                <div><p className="text-sm font-medium text-ink-800">{p.ref} <span className="font-normal text-ink-400">· {p.method}</span></p>
                  <p className="text-[11px] text-ink-400">{fmtDateTime(new Date(p.paidAt))}{p.note ? ` · ${p.note}` : ""}</p></div>
                <Money cents={p.isRefund ? -p.amountCents : p.amountCents} className={`font-medium ${p.isRefund ? "text-red-600" : "text-emerald-600"}`} />
              </div>
            ))}
          </div>
        </div>
      )}

      <PayModal open={pay} onClose={() => setPay(false)} invoice={inv} onDone={refresh} />
      <RefundModal open={refund} onClose={() => setRefund(false)} invoice={inv} onDone={refresh} />
    </div>
  );
}

/**
 * Records money going back to the customer.
 *
 * Deliberately a second entry rather than an edit of the original payment: both
 * sides stay on the invoice, so the history says what actually happened.
 */
function RefundModal({ open, onClose, invoice, onDone }: any) {
  const t = useT();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("BANK");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) { setAmount((invoice.paid / 100).toFixed(2)); setNote(""); } }, [open, invoice.paid]);

  async function go() {
    const cents = toCents(amount);
    if (cents <= 0) return toast("Enter an amount to refund", "err");
    if (cents > invoice.paid) return toast("That is more than has been paid on this invoice", "err");
    setBusy(true);
    try {
      await callAction("payments.refund", { invoiceId: invoice.id, amountCents: cents, method, note: note || undefined });
      toast("Refund recorded"); onDone(); onClose();
    } catch (e: any) { toast(humanError(e.message), "err"); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Record a refund">
      <div className="space-y-3">
        <div className="rounded-lg bg-ink-50 px-3 py-2.5 text-sm">
          <div className="flex justify-between"><span className="text-ink-500">{t("inv.paid")}</span>
            <span className="font-semibold"><Money cents={invoice.paid} /></span></div>
        </div>
        <Field label={`${t("common.amount")} (RM)`} hint="Cannot exceed what has been paid.">
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Method">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {["CASH","BANK","CARD","EWALLET","CHEQUE"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label={`Reason (${t("common.optional")})`}><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={go} disabled={busy}
            className="btn-sm rounded-lg bg-rose-600 px-3 py-2 font-medium text-white hover:bg-rose-700 disabled:bg-ink-200">
            {busy ? t("common.saving") : "Record refund"}</button>
        </div>
      </div>
    </Modal>
  );
}

const Line = ({ k, v, tone = "" }: { k: string; v: number; tone?: string }) => (
  <div className="flex justify-between"><dt className="text-ink-500">{k}</dt><dd className={tone}><Money cents={v} /></dd></div>
);

function PayModal({ open, onClose, invoice, onDone }: any) {
  const t = useT();
  const [amount, setAmount] = useState((invoice.balance / 100).toFixed(2));
  const [method, setMethod] = useState("BANK");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await callAction("payments.record", { invoiceId: invoice.id, amountCents: toCents(amount), method, reference: reference || undefined });
      toast("Payment recorded"); onDone(); onClose();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={t("inv.recordPayment")}>
      <div className="space-y-3">
        <div className="rounded-lg bg-ink-50 px-3 py-2.5 text-sm">
          <div className="flex justify-between"><span className="text-ink-500">{t("inv.balance")}</span>
            <span className="font-semibold"><Money cents={invoice.balance} /></span></div>
        </div>
        <Field label={`${t("common.amount")} (RM)`} hint="Partial payments are supported.">
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Method">
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
            {["CASH","BANK","CARD","EWALLET","CHEQUE"].map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label={`Reference (${t("common.optional")})`}><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={go} disabled={busy} className="btn-primary">{t("inv.recordPayment")}</button></div>
      </div>
    </Modal>
  );
}
