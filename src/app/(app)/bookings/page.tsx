"use client";
import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useT } from "@/components/I18nProvider";
import { useAction, Badge, Money, Empty } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import BookingForm from "@/components/BookingForm";
import { fmtDateTime, minsToLabel, isoDate } from "@/lib/dates";

function BookingsInner() {
  const t = useT();
  const sp = useSearchParams();
  const [open, setOpen] = useState(sp.get("new") === "1");
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState<"upcoming" | "all">("upcoming");

  const { data, loading, refresh } = useAction<any[]>("bookings.list", {
    ...(status ? { status } : {}),
    ...(scope === "upcoming" ? { from: isoDate(new Date()) } : {}),
    limit: 100,
  });

  return (
    <div>
      <PageHeader title={t("nav.bookings")} subtitle={`${data?.length ?? 0} ${t("common.shown")}`}
        actions={<button onClick={() => setOpen(true)} className="btn-primary btn-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          {t("common.new")}</button>} />

      <div className="mb-3 flex flex-wrap gap-2">
        <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5 text-xs font-medium">
          {(["upcoming", "all"] as const).map((s) => (
            <button key={s} onClick={() => setScope(s)}
              className={`rounded-md px-3 py-1.5 capitalize transition ${scope === s ? "bg-brand-600 text-white" : "text-ink-500 hover:text-ink-800"}`}>{s}</button>
          ))}
        </div>
        <select className="input w-auto text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t("common.all")} {t("common.status").toLowerCase()}</option>
          {["PENDING","CONFIRMED","COMPLETED","CANCELLED"].map((s) => <option key={s} value={s}>{t(`bk.status.${s}`)}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        {loading ? <p className="p-4 text-sm text-ink-400">{t("common.loading")}</p>
        : !data?.length ? <Empty text={t("common.empty")} />
        : <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-ink-100 bg-ink-50/50">
                <tr><th className="th">Ref</th><th className="th">{t("common.customer")}</th>
                  <th className="th">{t("common.date")}</th><th className="th">Services</th>
                  <th className="th text-right">{t("common.total")}</th><th className="th">{t("common.status")}</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {data.map((b) => (
                  <tr key={b.id} className="row-link" onClick={() => location.assign(`/bookings/${b.id}`)}>
                    <td className="td whitespace-nowrap">
                      <Link href={`/bookings/${b.id}`} className="font-medium text-ink-900 hover:text-brand-600">{b.ref}</Link>
                      {(b.recurrence && b.recurrence !== "NONE") || b.parentId ? (
                        <span className="ml-1.5 badge bg-purple-50 text-purple-600">↻</span>) : null}
                    </td>
                    <td className="td font-medium text-ink-800">{b.customer.name}</td>
                    <td className="td whitespace-nowrap text-ink-600">{fmtDateTime(new Date(b.startAt))}
                      <span className="ml-1 text-[11px] text-ink-400">{minsToLabel(b.durationMin)}</span></td>
                    <td className="td text-ink-500">{b.items.map((i: any) => i.name).join(", ")}</td>
                    <td className="td text-right font-medium"><Money cents={b.items.reduce((a: number, i: any) => a + i.qty * i.priceCents, 0)} /></td>
                    <td className="td"><Badge status={b.status} label={t(`bk.status.${b.status}`)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </div>

      <BookingForm open={open} onClose={() => setOpen(false)} onDone={refresh} />
    </div>
  );
}

export default function Bookings() {
  return <Suspense fallback={null}><BookingsInner /></Suspense>;
}
