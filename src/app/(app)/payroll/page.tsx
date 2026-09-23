"use client";
import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useAction, Money, Empty, Badge, callAction, toast, Stat } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { fmtDate, addDays, startOfMonth, endOfMonth, isoDate } from "@/lib/dates";


export default function Payroll() {
  const t = useT();
  const [from, setFrom] = useState(isoDate(startOfMonth(new Date())));
  const [to, setTo] = useState(isoDate(endOfMonth(new Date())));
  const calc = useAction<any>("payroll.calculate", { from, to });
  const payouts = useAction<any[]>("payroll.list", {});
  const [busy, setBusy] = useState("");

  const pending = (payouts.data ?? []).filter((p) => p.status === "PENDING");

  async function createPayout(line: any) {
    setBusy(line.staffId);
    try {
      await callAction("payroll.createPayout", { staffId: line.staffId, periodStart: new Date(from).toISOString(),
        periodEnd: new Date(to).toISOString(), amountCents: line.totalCents });
      toast(`Payout created for ${line.name}`); payouts.refresh();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(""); }
  }

  async function markPaid(id: string) {
    try { await callAction("payroll.markPaid", { payoutId: id }); toast("Marked paid"); payouts.refresh(); }
    catch (e: any) { toast(e.message, "err"); }
  }

  return (
    <div>
      <PageHeader title={t("nav.payroll")} subtitle="Cleaner earnings and payouts" actions={
        <div className="flex items-center gap-1.5">
          <input type="date" className="input w-auto text-xs" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="text-xs text-ink-400">→</span>
          <input type="date" className="input w-auto text-xs" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>} />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Period earnings" value={<Money cents={calc.data?.grandTotalCents ?? 0} />} />
        <Stat label="Outstanding payouts" value={<Money cents={pending.reduce((a, p) => a + p.amountCents, 0)} />} tone="warn" sub={`${pending.length} pending`} />
        <Stat label="Cleaners" value={calc.data?.lines?.length ?? 0} />
      </div>

      <div className="card mb-4 overflow-hidden">
        <div className="border-b border-ink-100 px-4 py-3">
          <p className="section-title">Earnings · {fmtDate(new Date(from))} — {fmtDate(new Date(to))}</p>
        </div>
        {calc.loading ? <p className="p-4 text-sm text-ink-400">{t("common.loading")}</p>
        : !calc.data?.lines?.length ? <Empty text={t("common.empty")} />
        : <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-ink-100 bg-ink-50/50">
                <tr><th className="th">Cleaner</th><th className="th">Pay basis</th>
                  <th className="th text-right">Hours</th><th className="th text-right">Jobs</th>
                  <th className="th text-right">Earned</th><th className="th text-right">Reimburse</th>
                  <th className="th text-right">{t("common.total")}</th><th className="th"></th></tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {calc.data.lines.map((l: any) => (
                  <tr key={l.staffId}>
                    <td className="td font-medium text-ink-900">{l.name}</td>
                    <td className="td text-ink-500">
                      {l.payType === "HOURLY" ? <><Money cents={l.payRate} />/hr</>
                        : l.payType === "PER_JOB" ? <><Money cents={l.payRate} />/job</>
                        : `${l.payRate / 100}% of job value`}
                      {l.fixedJobs > 0 && <span className="block text-[11px] text-ink-400">{l.fixedJobs} job{l.fixedJobs > 1 ? "s" : ""} at a set amount</span>}
                    </td>
                    <td className="td text-right tabular-nums">{l.hours}</td>
                    <td className="td text-right tabular-nums">{l.jobsCompleted}</td>
                    <td className="td text-right"><Money cents={l.earnedCents} /></td>
                    <td className="td text-right text-ink-400"><Money cents={l.reimbursementsCents} /></td>
                    <td className="td text-right font-semibold"><Money cents={l.totalCents} /></td>
                    <td className="td text-right">
                      <button onClick={() => createPayout(l)} disabled={busy === l.staffId || l.totalCents <= 0} className="btn-outline btn-sm">
                        Create payout</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">Payout history</p></div>
        {!payouts.data?.length ? <Empty text={t("common.empty")} />
        : <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead className="border-b border-ink-100 bg-ink-50/50">
                <tr><th className="th">Ref</th><th className="th">Cleaner</th><th className="th">Period</th>
                  <th className="th text-right">{t("common.amount")}</th><th className="th">{t("common.status")}</th><th className="th"></th></tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {payouts.data.map((p) => (
                  <tr key={p.id}>
                    <td className="td whitespace-nowrap font-medium text-ink-800">{p.ref}</td>
                    <td className="td">{p.staff}</td>
                    <td className="td whitespace-nowrap text-ink-500">{fmtDate(new Date(p.periodStart))} — {fmtDate(new Date(p.periodEnd))}</td>
                    <td className="td text-right font-medium"><Money cents={p.amountCents} /></td>
                    <td className="td"><Badge status={p.status === "PAID" ? "PAID" : "PENDING"} /></td>
                    <td className="td text-right">
                      {p.status === "PENDING" && <button onClick={() => markPaid(p.id)} className="btn-outline btn-sm">Mark paid</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </div>
    </div>
  );
}
