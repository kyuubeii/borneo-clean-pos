"use client";
import { useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Money, Empty, Stat, ConfirmDelete } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { useCan, OWNER_ONLY } from "@/components/UserProvider";
import { fmtDateTime, addDays, isoDate } from "@/lib/dates";


export default function Payments() {
  const t = useT();
  const [days, setDays] = useState(30);
  const [deleting, setDeleting] = useState<any>(null);
  // payments.delete is OWNER-only in the registry.
  const canDelete = useCan(OWNER_ONLY);
  const { data, loading, refresh } = useAction<any[]>("payments.list", { from: isoDate(addDays(new Date(), -days)), limit: 200 });
  const out = useAction<any>("payments.outstanding", {});

  const received = (data ?? []).reduce((a, p) => a + p.amountCents, 0);

  return (
    <div>
      <PageHeader title={t("nav.payments")} subtitle={t("common.lastDays").replace("{n}", String(days))} actions={
        <select className="input w-auto text-xs" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[7, 30, 90, 365].map((d) => <option key={d} value={d}>{t("common.lastDays").replace("{n}", String(d))}</option>)}
        </select>} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Received" value={<Money cents={received} />} tone="good" sub={`${data?.length ?? 0} payments`} />
        <Stat label={t("dash.outstanding")} value={<Money cents={out.data?.totalOutstandingCents ?? 0} />} tone="warn" />
        <Stat label="Overdue" value={<Money cents={out.data?.overdueCents ?? 0} />} tone="bad" />
        <Stat label="Customers owing" value={out.data?.byCustomer?.length ?? 0} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-2">
          <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">Payment history</p></div>
          {loading ? <p className="p-4 text-sm text-ink-400">{t("common.loading")}</p>
          : !data?.length ? <Empty text={t("common.empty")} />
          : <div className="max-h-[32rem] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 border-b border-ink-100 bg-ink-50/90 backdrop-blur">
                  <tr><th className="th">Ref</th><th className="th">{t("common.customer")}</th>
                    <th className="th">{t("common.date")}</th><th className="th">Method</th>
                    <th className="th text-right">{t("common.amount")}</th>
                    {canDelete && <th className="th w-px"></th>}</tr>
                </thead>
                <tbody className="divide-y divide-ink-50">
                  {data.map((p) => (
                    <tr key={p.id}>
                      <td className="td font-medium text-ink-800">{p.ref}
                        {p.isRefund && <span className="ml-1 badge bg-red-50 text-red-600">Refund</span>}</td>
                      <td className="td">{p.customer}</td>
                      <td className="td whitespace-nowrap text-ink-500">{fmtDateTime(new Date(p.paidAt))}</td>
                      <td className="td"><span className="badge bg-ink-100 text-ink-600">{p.method}</span></td>
                      <td className="td text-right font-medium"><Money cents={p.amountCents} className={p.amountCents < 0 ? "text-red-600" : "text-emerald-600"} /></td>
                      {canDelete && (
                        <td className="td text-right">
                          <button onClick={() => setDeleting(p)} title="Delete this entry permanently"
                            className="rounded-lg border border-ink-200 p-1.5 text-ink-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
        </div>

        <div className="card">
          <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">Who owes money</p></div>
          <div className="max-h-[32rem] divide-y divide-ink-50 overflow-y-auto">
            {!out.data?.byCustomer?.length ? <Empty text="Everyone's paid up" />
            : out.data.byCustomer.map((c: any) => (
              <Link key={c.customerId} href={`/customers/${c.customerId}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-ink-50">
                <div className="min-w-0"><p className="truncate text-sm font-medium text-ink-800">{c.customer}</p>
                  <p className="text-[11px] text-ink-400">{c.invoices} invoice{c.invoices === 1 ? "" : "s"}</p></div>
                <Money cents={c.balanceCents} className="font-medium text-amber-600" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      <ConfirmDelete
        open={!!deleting} onClose={() => setDeleting(null)} onDone={() => { refresh(); out.refresh(); }}
        title="Delete payment entry permanently"
        action="payments.delete" input={{ paymentId: deleting?.id }}
        confirmText={deleting?.ref} confirmLabel="the payment reference"
        alternative={<>If the money was genuinely returned to the customer, record a <strong>refund</strong> on the invoice instead. That keeps both entries and leaves an honest trail.</>}>
        Payment <strong>{deleting?.ref}</strong> from {deleting?.customer} is removed for
        good, and your takings will change by <Money cents={Math.abs(deleting?.amountCents ?? 0)} />.
        {deleting?.invoiceRef ? <> Invoice {deleting.invoiceRef} will be re-checked and may go back to unpaid.</> : null}
        <br /><br />
        Use this only for an entry recorded in error \u2014 a typo, or the same payment
        entered twice. This cannot be undone.
      </ConfirmDelete>
    </div>
  );
}
