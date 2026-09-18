"use client";
import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useAction, Money, Empty, Stat } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { startOfMonth, endOfMonth, addDays, addMonths, fmtDate } from "@/lib/dates";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const PRESETS = [
  { key: "month", label: "This month", from: () => startOfMonth(new Date()), to: () => endOfMonth(new Date()) },
  { key: "last", label: "Last month", from: () => startOfMonth(addMonths(new Date(), -1)), to: () => endOfMonth(addMonths(new Date(), -1)) },
  { key: "90", label: "Last 90 days", from: () => addDays(new Date(), -90), to: () => new Date() },
  { key: "year", label: "Last 12 months", from: () => addMonths(new Date(), -12), to: () => new Date() },
];

export default function Reports() {
  const t = useT();
  const [preset, setPreset] = useState("month");
  const p = PRESETS.find((x) => x.key === preset)!;
  const from = iso(p.from()), to = iso(p.to());
  const long = preset === "year";

  const summary = useAction<any>("reports.summary", { from, to });
  const byService = useAction<any[]>("reports.revenueByService", { from, to });
  const topCust = useAction<any[]>("reports.topCustomers", { from, to, limit: 10 });
  const staffPerf = useAction<any[]>("reports.staffPerformance", { from, to });
  const expenses = useAction<any[]>("reports.expenseBreakdown", { from, to });
  const trend = useAction<any[]>("reports.revenueTrend", { from, to, granularity: long ? "month" : "day" });

  const s = summary.data;

  return (
    <div className="space-y-4">
      <PageHeader title={t("nav.reports")} subtitle={`${fmtDate(p.from())} — ${fmtDate(p.to())}`} actions={
        <>
          <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5 text-xs font-medium">
            {PRESETS.map((x) => (
              <button key={x.key} onClick={() => setPreset(x.key)}
                className={`rounded-md px-2.5 py-1.5 transition ${preset === x.key ? "bg-brand-600 text-white" : "text-ink-500 hover:text-ink-800"}`}>{x.label}</button>
            ))}
          </div>
          <button onClick={() => window.print()} className="btn-outline btn-sm">{t("common.print")}</button>
        </>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue collected" value={<Money cents={s?.revenueCollectedCents ?? 0} />} tone="good" sub={<>Invoiced <Money cents={s?.invoicedCents ?? 0} /></>} />
        <Stat label="Expenses" value={<Money cents={s?.expenseCents ?? 0} />} tone="warn" sub={<>Labour <Money cents={s?.labourCents ?? 0} /></>} />
        <Stat label="Profit" value={<Money cents={s?.profitCents ?? 0} />} tone={(s?.profitCents ?? 0) >= 0 ? "good" : "bad"} sub={`${s?.marginPct ?? 0}% margin`} />
        <Stat label="Jobs" value={s?.jobsScheduled ?? 0} sub={`${s?.jobsCompleted ?? 0} completed · ${s?.jobsCancelled ?? 0} cancelled`} />
      </div>

      <div className="card">
        <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">Revenue trend</p></div>
        <div className="p-4"><Bars data={trend.data ?? []} /></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Table title="Revenue by service" cols={["Service", "Jobs", "Revenue"]} rows={(byService.data ?? []).map((r) => [
          <span key="a" className="font-medium text-ink-800">{r.service}</span>, r.jobs, <Money key="c" cents={r.revenueCents} />])} />
        <Table title="Top customers" cols={["Customer", "Payments", "Paid"]} rows={(topCust.data ?? []).map((r) => [
          <span key="a" className="font-medium text-ink-800">{r.customer}</span>, r.payments, <Money key="c" cents={r.paidCents} />])} />
        <Table title="Staff performance" cols={["Cleaner", "Jobs", "Hours", "Revenue"]} rows={(staffPerf.data ?? []).map((r) => [
          <span key="a" className="font-medium text-ink-800">{r.name}</span>,
          `${r.jobsCompleted}/${r.jobsAssigned}`, r.hours, <Money key="d" cents={r.revenueGeneratedCents} />])} />
        <Table title="Expenses by category" cols={["Category", "Count", "Amount"]} rows={(expenses.data ?? []).map((r) => [
          <span key="a" className="font-medium text-ink-800">{r.category}</span>, r.count, <Money key="c" cents={r.amountCents} />])} />
      </div>
    </div>
  );
}

function Table({ title, cols, rows }: { title: string; cols: string[]; rows: any[][] }) {
  const t = useT();
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">{title}</p></div>
      {!rows.length ? <Empty text={t("common.empty")} /> : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-ink-100 bg-ink-50/50">
              <tr>{cols.map((c, i) => <th key={c} className={`th ${i > 0 ? "text-right" : ""}`}>{c}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-ink-50">
              {rows.map((r, i) => (
                <tr key={i}>{r.map((cell, n) => <td key={n} className={`td ${n > 0 ? "text-right tabular-nums" : ""}`}>{cell}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Bars({ data }: { data: { period: string; revenueCents: number }[] }) {
  if (!data.length) return <p className="py-10 text-center text-sm text-ink-400">—</p>;
  const max = Math.max(...data.map((d) => d.revenueCents), 1);
  return (
    <div>
      <div className="flex h-40 items-end gap-[2px]">
        {data.map((d) => (
          <div key={d.period} className="group relative min-w-0 flex-1" title={`${d.period}: RM ${(d.revenueCents / 100).toFixed(2)}`}>
            <div className="w-full rounded-t bg-brand-500/80 transition group-hover:bg-brand-600"
              style={{ height: `${Math.max(2, (d.revenueCents / max) * 160)}px` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-ink-400">
        <span>{data[0]?.period}</span><span>Peak RM {(max / 100).toFixed(0)}</span><span>{data[data.length - 1]?.period}</span>
      </div>
    </div>
  );
}
