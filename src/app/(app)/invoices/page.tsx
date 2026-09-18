"use client";
import { useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Badge, Money, Empty, Stat } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { fmtDate } from "@/lib/dates";

export default function Invoices() {
  const t = useT();
  const [status, setStatus] = useState("");
  const [unpaid, setUnpaid] = useState(false);
  const { data, loading } = useAction<any[]>("invoices.list", { ...(status ? { status } : {}), unpaidOnly: unpaid, limit: 200 });
  const out = useAction<any>("payments.outstanding", {});

  return (
    <div>
      <PageHeader title={t("nav.invoices")} subtitle={`${data?.length ?? 0} ${t("common.shown")}`} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("dash.outstanding")} value={<Money cents={out.data?.totalOutstandingCents ?? 0} />} tone="warn" />
        <Stat label="Overdue" value={<Money cents={out.data?.overdueCents ?? 0} />} sub={`${out.data?.overdueInvoices ?? 0} invoices`} tone={(out.data?.overdueCents ?? 0) > 0 ? "bad" : "default"} />
        <Stat label="Open invoices" value={out.data?.openInvoices ?? 0} />
        <Stat label="Customers owing" value={out.data?.byCustomer?.length ?? 0} />
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <select className="input w-auto text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("common.all")} {t("common.status").toLowerCase()}</option>
          {["DRAFT","SENT","PARTIAL","PAID","OVERDUE","VOID"].map((s) => <option key={s} value={s}>{t(`inv.status.${s}`)}</option>)}
        </select>
        <label className="flex items-center gap-1.5 rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs text-ink-600">
          <input type="checkbox" checked={unpaid} onChange={(e) => setUnpaid(e.target.checked)} /> Unpaid only
        </label>
      </div>

      <div className="card overflow-hidden">
        {loading ? <p className="p-4 text-sm text-ink-400">{t("common.loading")}</p>
        : !data?.length ? <Empty text={t("common.empty")} />
        : <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-ink-100 bg-ink-50/50">
                <tr><th className="th">Ref</th><th className="th">{t("common.customer")}</th>
                  <th className="th">{t("inv.issued")}</th><th className="th">{t("inv.dueDate")}</th>
                  <th className="th text-right">{t("common.total")}</th><th className="th text-right">{t("inv.paid")}</th>
                  <th className="th text-right">{t("inv.balance")}</th><th className="th">{t("common.status")}</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {data.map((i) => (
                  <tr key={i.id} className="row-link" onClick={() => location.assign(`/invoices/${i.id}`)}>
                    <td className="td whitespace-nowrap"><Link href={`/invoices/${i.id}`} className="font-medium text-ink-900 hover:text-brand-600">{i.ref}</Link></td>
                    <td className="td font-medium text-ink-800">{i.customer}</td>
                    <td className="td whitespace-nowrap text-ink-500">{fmtDate(new Date(i.issuedAt))}</td>
                    <td className={`td whitespace-nowrap ${i.overdue ? "font-medium text-red-600" : "text-ink-500"}`}>{i.dueAt ? fmtDate(new Date(i.dueAt)) : "—"}</td>
                    <td className="td text-right"><Money cents={i.totalCents} /></td>
                    <td className="td text-right text-emerald-600"><Money cents={i.paidCents} /></td>
                    <td className="td text-right font-medium"><Money cents={i.balanceCents} className={i.balanceCents > 0 ? "text-amber-600" : "text-ink-300"} /></td>
                    <td className="td"><Badge status={i.status} label={t(`inv.status.${i.status}`)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </div>
    </div>
  );
}
