"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Badge, Money, Empty, Modal, Field, callAction, toast, humanError } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { useCan, ADMIN_UP } from "@/components/UserProvider";
import { fmtDateTime } from "@/lib/dates";
import { toCents } from "@/lib/money";
import InvoiceDocument, { MAX_DOCUMENT_LINES } from "@/components/InvoiceDocument";

export default function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const { data: inv, loading, refresh } = useAction<any>("invoices.get", { invoiceId: id });
  const biz = useAction<any>("settings.get", {});
  const [pay, setPay] = useState(false);
  const [refund, setRefund] = useState(false);
  const [clipped, setClipped] = useState(false);
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

      {clipped && (
        <div className="no-print mx-auto max-w-3xl rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          This invoice has {inv.items.length} lines and no longer fits the one-page A4 format
          (up to {MAX_DOCUMENT_LINES} fit). Printing it will cut off the bottom of the sheet —
          shorten the descriptions, or split it across two invoices.
        </div>
      )}

      <div className="mx-auto max-w-3xl">
        <InvoiceDocument
          kind="INVOICE" docRef={inv.ref} customer={inv.customer}
          issuedAt={inv.issuedAt} dueAt={inv.dueAt} items={inv.items}
          discountCents={inv.discountCents} taxRateBp={inv.taxRateBp}
          notes={inv.notes} business={s} onOverflowChange={setClipped} paidCents={inv.paid}
        />
      </div>

      {/* What is owed after payments. The printed sheet states the amount due on
          the day it was raised, so this belongs beside it rather than on it. */}
      <div className="no-print card mx-auto max-w-3xl card-pad">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="section-title">{t("inv.balance")}</p>
          <Badge status={inv.status} label={t(`inv.status.${inv.status}`)} />
        </div>
        <dl className="mt-3 space-y-1.5 text-sm">
          <Line k={t("common.total")} v={inv.total} />
          <Line k={t("inv.paid")} v={inv.paid} tone="text-emerald-600" />
          <div className="flex justify-between border-t border-ink-100 pt-1.5">
            <dt className="font-semibold">{t("inv.balance")}</dt>
            <dd className={`text-base font-semibold ${inv.balance > 0 ? "text-amber-600" : "text-emerald-600"}`}><Money cents={inv.balance} /></dd>
          </div>
        </dl>
      </div>

      {inv.payments.length > 0 && (
        <div className="card mx-auto max-w-3xl">
          <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">{t("nav.payments")}</p></div>
          <div className="divide-y divide-ink-50">
            {inv.payments.map((p: any) => (
              <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                <div><p className="text-sm font-medium text-ink-800">{p.ref} <span className="font-normal text-ink-400">· {p.method}{p.receivedBy ? ` · ${t("pay.collectedBy")} ${p.receivedBy.name}` : ""}</span></p>
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
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title="Record a refund">
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
  // Empty means the owner received it; a cleaner's id means they collected it and keep it.
  const [receivedById, setReceivedById] = useState("");
  const staff = useAction<any[]>("staff.list", {});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setAmount((invoice.balance / 100).toFixed(2)); setReference(""); setReceivedById(""); } }, [open, invoice.id, invoice.balance]);
  async function go() {
    const cents = toCents(amount);
    if (cents <= 0 || cents > invoice.balance) return toast("Enter an amount greater than zero and no more than the balance", "err");
    setBusy(true);
    try {
      await callAction("payments.record", { invoiceId: invoice.id, amountCents: toCents(amount), method, reference: reference || undefined, receivedById: receivedById || undefined });
      toast("Payment recorded"); onDone(); onClose();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={() => { if (!busy) onClose(); }} title={t("inv.recordPayment")}>
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
        <Field label={t("pay.receivedBy")} hint={receivedById ? t("pay.keptHint") : undefined}>
          <select id="pay-received-by" className="input" value={receivedById} onChange={(e) => setReceivedById(e.target.value)}>
            <option value="">{t("pay.me")}</option>
            {(staff.data ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label={`Reference (${t("common.optional")})`}><input className="input" value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={go} disabled={busy} className="btn-primary">{busy ? t("common.saving") : t("inv.recordPayment")}</button></div>
      </div>
    </Modal>
  );
}
