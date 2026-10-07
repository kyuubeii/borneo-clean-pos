"use client";
import { useT } from "@/components/I18nProvider";
import { useAction, LoadError } from "@/components/ui";

/**
 * The month's money laid out like the owner's spreadsheet: one sheet for the
 * owner's cash, one per worker. Same columns, same totals, same carry-forward.
 */
const num = (c: number | undefined) =>
  !c ? "-" : (c / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };

type Col = { key: string; label: string };
type Foot = { label: string; col: string; cents: number; strong?: boolean };

function Sheet({ title, second, cols, rows, totals, foot }: {
  title: string; second: string; cols: Col[]; rows: any[]; totals: Record<string, number>; foot: Foot[];
}) {
  const t = useT();
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">{title}</p></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm tabular-nums">
          <thead>
            <tr className="bg-[#0E7C7B] text-white">
              <th className="px-3 py-2 text-left text-xs font-semibold">{t("ledger.date")}</th>
              <th className="px-3 py-2 text-left text-xs font-semibold">{second}</th>
              {cols.map((c) => <th key={c.key} className="px-3 py-2 text-right text-xs font-semibold">{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {rows.length === 0 && (
              <tr><td colSpan={cols.length + 2} className="px-3 py-4 text-center text-xs text-ink-400">{t("ledger.nothing")}</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap px-3 py-1.5 text-ink-500">{day(r.date)}</td>
                <td className="px-3 py-1.5 text-ink-800">{r.label}{r.ref && <span className="ml-1.5 text-[11px] text-ink-400">{r.ref}</span>}</td>
                {cols.map((c) => <td key={c.key} className="px-3 py-1.5 text-right">{num(r[c.key])}</td>)}
              </tr>
            ))}
            <tr className="border-t-2 border-ink-700 bg-[#E2F2F1] font-semibold text-ink-900">
              <td className="px-3 py-2" /><td className="px-3 py-2">{t("common.total")}</td>
              {cols.map((c) => <td key={c.key} className="px-3 py-2 text-right">{num(totals[c.key])}</td>)}
            </tr>
            {foot.map((f) => (
              <tr key={f.label} className={f.strong ? "font-semibold text-ink-900" : "text-ink-600"}>
                <td className="px-3 py-2" /><td className="px-3 py-2">{f.label}</td>
                {cols.map((c) => <td key={c.key} className="px-3 py-2 text-right">{c.key === f.col ? num(f.cents) : ""}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Ledger({ month }: { month: string }) {
  const t = useT();
  const { data, error, refresh, loading } = useAction<any>("reports.ledger", { month });
  if (error) return <LoadError error={error} onRetry={refresh} />;
  if (loading || !data) return <p className="text-sm text-ink-400">{t("common.loading")}</p>;
  const o = data.owner;
  const ownerCols: Col[] = [
    { key: "collectedCents", label: t("ledger.collected") },
    { key: "paidCents", label: t("ledger.paid") },
    { key: "uncollectedCents", label: t("ledger.uncollected") },
  ];
  const workerCols: Col[] = [
    { key: "expenseCents", label: t("ledger.expense") },
    { key: "driverCents", label: t("ledger.driver") },
    { key: "fromOwnerCents", label: `${t("ledger.from")} ${data.ownerName} (RM)` },
    { key: "fromCustomerCents", label: t("ledger.fromCustomer") },
  ];
  return (
    <div className="space-y-4">
      <p className="text-xs text-ink-500">{t("ledger.intro")}</p>
      <Sheet title={data.ownerName} second={t("ledger.customerPaidTo")} cols={ownerCols} rows={o.rows} totals={o.totals} foot={[
        { label: t("ledger.broughtForward"), col: "collectedCents", cents: o.broughtForwardCents },
        { label: t("ledger.balance"), col: "collectedCents", cents: o.balanceCents, strong: true },
      ]} />
      {data.workers.map((w: any) => (
        <Sheet key={w.staffId} title={w.name} second={t("ledger.itemFrom")} cols={workerCols} rows={w.rows} totals={w.totals} foot={[
          { label: t("ledger.broughtForward"), col: "expenseCents", cents: w.broughtForwardCents },
          { label: `${t("ledger.owedTo")} ${w.name}`, col: "expenseCents", cents: w.owedCents, strong: true },
          ...(w.driverEarnedToDateCents ? [{ label: t("ledger.driverToDate"), col: "driverCents", cents: w.driverEarnedToDateCents }] : []),
        ]} />
      ))}
    </div>
  );
}
