"use client";
import { useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Badge, Money, Empty } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { fmtDateTime, addDays, minsToLabel, isoDate } from "@/lib/dates";

const RANGES = [
  { key: "today", label: "common.today", from: () => isoDate(new Date()), to: () => isoDate(new Date()) },
  { key: "week", label: "cal.week", from: () => isoDate(new Date()), to: () => isoDate(addDays(new Date(), 7)) },
  { key: "past", label: "common.past30", from: () => isoDate(addDays(new Date(), -30)), to: () => isoDate(new Date()) },
  { key: "all", label: "common.all", from: () => undefined, to: () => undefined },
];

export default function Jobs() {
  const t = useT();
  const [range, setRange] = useState("week");
  const [status, setStatus] = useState("");
  const r = RANGES.find((x) => x.key === range)!;
  const { data, loading } = useAction<any[]>("jobs.list", {
    from: r.from(), to: r.to(), ...(status ? { status } : {}), limit: 100,
  });

  return (
    <div>
      <PageHeader title={t("nav.jobs")} subtitle={`${data?.length ?? 0} ${t("common.shown")}`} />

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5 text-xs font-medium">
          {RANGES.map((x) => (
            <button key={x.key} onClick={() => setRange(x.key)}
              className={`rounded-md px-3 py-1.5 transition ${range === x.key ? "bg-brand-600 text-white" : "text-ink-500 hover:text-ink-800"}`}>
              {x.label.includes(".") ? t(x.label) : x.label}
            </button>
          ))}
        </div>
        <select className="input w-auto text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("common.all")} {t("common.status").toLowerCase()}</option>
          {["SCHEDULED","EN_ROUTE","IN_PROGRESS","COMPLETED","CANCELLED"].map((s) => <option key={s} value={s}>{t(`job.status.${s}`)}</option>)}
        </select>
      </div>

      {/* Card list on mobile, table on desktop — cleaners work from phones. */}
      <div className="space-y-2 sm:hidden">
        {(data ?? []).map((j) => (
          <Link key={j.id} href={`/jobs/${j.id}`} className="card card-pad block">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-900">{j.customer}</p>
                <p className="text-[11px] text-ink-400">{fmtDateTime(new Date(j.scheduledAt))}</p>
              </div>
              <Badge status={j.status} label={t(`job.status.${j.status}`)} />
            </div>
            {j.address && <p className="mt-1.5 truncate text-xs text-ink-500">📍 {j.address}</p>}
            <div className="mt-1.5 flex items-center justify-between text-xs">
              <span className="text-ink-400">{j.cleaners.length ? j.cleaners.join(", ") : <span className="text-amber-600">{t("cal.unassigned")}</span>}</span>
              <Money cents={j.revenueCents} className="font-medium text-ink-700" />
            </div>
          </Link>
        ))}
      </div>

      <div className="card hidden overflow-hidden sm:block">
        {loading ? <p className="p-4 text-sm text-ink-400">{t("common.loading")}</p>
        : !data?.length ? <Empty text={t("common.empty")} />
        : <div className="overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="border-b border-ink-100 bg-ink-50/50">
                <tr><th className="th">Ref</th><th className="th">{t("common.date")}</th>
                  <th className="th">{t("common.customer")}</th><th className="th">{t("common.address")}</th>
                  <th className="th">{t("job.cleaners")}</th><th className="th text-right">{t("job.revenue")}</th>
                  <th className="th">{t("common.status")}</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {data.map((j) => (
                  <tr key={j.id} className="row-link" onClick={() => location.assign(`/jobs/${j.id}`)}>
                    <td className="td whitespace-nowrap"><Link href={`/jobs/${j.id}`} className="font-medium text-ink-900 hover:text-brand-600">{j.ref}</Link></td>
                    <td className="td whitespace-nowrap text-ink-600">{fmtDateTime(new Date(j.scheduledAt))}
                      <span className="ml-1 text-[11px] text-ink-400">{minsToLabel(j.durationMin)}</span></td>
                    <td className="td font-medium text-ink-800">{j.customer}</td>
                    <td className="td max-w-[200px] truncate text-ink-500">{j.address ?? "—"}</td>
                    <td className="td text-ink-500">{j.cleaners.length ? j.cleaners.join(", ") : <span className="text-amber-600">{t("cal.unassigned")}</span>}</td>
                    <td className="td text-right font-medium"><Money cents={j.revenueCents} /></td>
                    <td className="td"><Badge status={j.status} label={t(`job.status.${j.status}`)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </div>
    </div>
  );
}
