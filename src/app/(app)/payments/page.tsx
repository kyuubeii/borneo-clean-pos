"use client";
import { useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Money, Empty, Stat } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { fmtDateTime, addDays, isoDate } from "@/lib/dates";


export default function Payments() {
  const t = useT();
  const [days, setDays] = useState(30);
  const { data, loading } = useAction<any[]>("payments.list", { from: isoDate(addDays(new Date(), -days)), limit: 200 });
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
                    <th className="th text-right">{t("common.amount")}</th></tr>
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
    </div>
  );
}
