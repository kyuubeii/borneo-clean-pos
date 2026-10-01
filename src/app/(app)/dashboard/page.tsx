"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useT } from "@/components/I18nProvider";
import { useAction, Stat, Badge, Money, Empty, LoadError, MonthPicker } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import StaffDashboard from "@/components/StaffDashboard";
import { useIsStaff } from "@/components/UserProvider";
import { fmtTime, fmtDate, startOfMonth, endOfMonth, isoDate } from "@/lib/dates";


export default function Dashboard() {
  const isStaff = useIsStaff();
  // Cleaners get their own day; the business dashboard needs owner/admin data.
  if (isStaff) return <StaffDashboard />;
  return <OwnerDashboard />;
}

function OwnerDashboard() {
  const t = useT();
  const today = new Date();
  // The month the sales figures and the revenue chart cover. Today's jobs,
  // what is owed, upcoming bookings and activity are always about now.
  const [month, setMonth] = useState(() => startOfMonth(today));
  const monthFrom = isoDate(startOfMonth(month)), monthTo = isoDate(endOfMonth(month));
  const isThisMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();
  const monthName = month.toLocaleDateString("en-MY", { month: "short", year: "numeric" });
  const inMonth = (thisMonthKey: string, key: string) => isThisMonth ? t(thisMonthKey) : `${t(key)} · ${monthName}`;

  const brief = useAction<any>("reports.dailyBriefing", {});
  const summary = useAction<any>("reports.summary", { from: monthFrom, to: monthTo });
  const outstanding = useAction<any>("payments.outstanding", {});
  const upcoming = useAction<any[]>("bookings.list", { from: isoDate(new Date(Date.now() + 86400000)), limit: 6, status: "CONFIRMED" });
  const activity = useAction<any[]>("audit.list", { limit: 8 });
  const trend = useAction<any[]>("reports.revenueTrend", { from: monthFrom, to: monthTo, granularity: "day" });

  const s = summary.data, b = brief.data, o = outstanding.data;
  const attention = b?.needsAttention;
  const hasAttention = attention && (attention.unassignedJobs?.length > 0 || attention.overdueInvoices > 0);

  /**
   * A figure that has not arrived is not a figure of zero.
   *
   * These headline numbers used to fall back to `?? 0`, so a query that failed
   * or had not answered yet showed a confident RM 0.00 — indistinguishable from
   * a month with no sales, and alarming on the one screen that is read at a
   * glance. An absent figure now reads as a dash, and the reason sits above it.
   */
  const figure = (q: { data: any; error: string | null }, render: (d: any) => ReactNode) =>
    q.data ? render(q.data) : <span className="text-ink-300">{q.error ? "unavailable" : "—"}</span>;

  return (
    <div className="space-y-4">
      <PageHeader title={t("dash.title")} subtitle={fmtDate(today)} actions={
        <>
          <Link href="/bookings?new=1" className="btn-primary btn-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            {t("nav.bookings")}
          </Link>
          <Link href="/calendar" className="btn-outline btn-sm">{t("nav.calendar")}</Link>
        </>
      } />

      <div className="flex justify-end"><MonthPicker value={month} onChange={setMonth} thisMonthLabel={t("dash.thisMonth")} /></div>

      <LoadError error={summary.error ?? outstanding.error} onRetry={() => { summary.refresh(); outstanding.refresh(); brief.refresh(); trend.refresh(); }} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={inMonth("dash.salesMonth", "dash.sales")} value={figure(summary, (d) => <Money cents={d.salesCents} />)}
          sub={s && <>{t("dash.collected")} <Money cents={s.revenueCollectedCents} /> · {t("dash.profit")} <Money cents={s.profitCents} /> ({s.marginPct}%)</>}
          tone={!s ? "default" : s.profitCents >= 0 ? "good" : "bad"} />
        <Stat label={t("dash.outstanding")} value={figure(outstanding, (d) => <Money cents={d.totalOutstandingCents} />)}
          sub={o && `${o.openInvoices} open · ${o.overdueInvoices} ${t("dash.overdueInvoices")}`}
          tone={o && o.overdueCents > 0 ? "warn" : "default"} />
        <Stat label={inMonth("dash.jobsThisMonth", "dash.jobs")} value={figure(summary, (d) => d.jobsScheduled)}
          sub={s && `${s.jobsCompleted} ${t("dash.completed").toLowerCase()}${s.jobsCancelled ? ` · ${s.jobsCancelled} ${t("job.status.CANCELLED").toLowerCase()}` : ""}`} />
        <Stat label={t("dash.avgJob")} value={figure(summary, (d) => <Money cents={d.avgJobValueCents} />)}
          sub={s && `${s.newCustomers} ${t("dash.newCustomers").toLowerCase()}`} />
      </div>

      {hasAttention && (
        <div className="card border-amber-200 bg-amber-50/60 card-pad">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-900">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0"/></svg>
            {t("dash.needsAttention")}
          </p>
          <div className="flex flex-wrap gap-2">
            {attention.unassignedJobs?.length > 0 && (
              <Link href="/calendar" className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50">
                {attention.unassignedJobs.length} {t("dash.unassigned_plural")}
              </Link>
            )}
            {attention.overdueInvoices > 0 && (
              <Link href="/invoices" className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50">
                {attention.overdueInvoices} {t("dash.overdueInvoices")} · <Money cents={attention.overdueAmountCents} />
              </Link>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <p className="section-title">{t("dash.todayJobs")}</p>
            <Link href="/jobs" className="text-xs font-medium text-brand-600 hover:underline">{t("common.view")}</Link>
          </div>
          {brief.loading ? <div className="p-4 text-sm text-ink-400">{t("common.loading")}</div>
            : !b?.jobs?.length ? <Empty text={t("dash.noJobsToday")} />
            : <div className="divide-y divide-ink-50">
                {b.jobs.map((j: any) => (
                  <div key={j.ref} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="w-14 shrink-0 text-xs font-semibold tabular-nums text-ink-500">{fmtTime(new Date(j.time))}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-800">{j.customer}</p>
                      <p className="truncate text-[11px] text-ink-400">
                        {j.ref} · {j.cleaners.length ? j.cleaners.join(", ") : <span className="text-amber-600">{t("cal.unassigned")}</span>}
                      </p>
                    </div>
                    <Badge status={j.status} label={t(`job.status.${j.status}`)} />
                  </div>
                ))}
              </div>}
        </div>

        <div className="card">
          <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">{t("dash.upcoming")}</p></div>
          {!upcoming.data?.length ? <Empty text={t("common.empty")} />
            : <div className="divide-y divide-ink-50">
                {upcoming.data.map((bk: any) => (
                  <Link key={bk.id} href={`/bookings/${bk.id}`} className="block px-4 py-2.5 hover:bg-ink-50">
                    <p className="truncate text-sm font-medium text-ink-800">{bk.customer.name}</p>
                    <p className="text-[11px] text-ink-400">{fmtDate(new Date(bk.startAt))} · {fmtTime(new Date(bk.startAt))}</p>
                  </Link>
                ))}
              </div>}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">{inMonth("dash.revenueMonth", "dash.revenue")}</p></div>
          <div className="p-4"><Sparkline data={trend.data ?? []} /></div>
        </div>
        <div className="card">
          <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">{t("dash.activity")}</p></div>
          <div className="divide-y divide-ink-50">
            {(activity.data ?? []).slice(0, 8).map((a: any) => (
              <div key={a.id} className="flex items-start gap-2 px-4 py-2">
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${a.ok ? "bg-emerald-400" : "bg-red-400"}`} />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-ink-700">{a.action}</p>
                  <p className="text-[10px] text-ink-400">{a.actorName} · {a.source} · {new Date(a.createdAt).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Lightweight inline bar chart — no charting dependency for a single sparkline. */
function Sparkline({ data }: { data: { period: string; revenueCents: number }[] }) {
  if (!data.length) return <p className="py-8 text-center text-sm text-ink-400">—</p>;
  const max = Math.max(...data.map((d) => d.revenueCents), 1);
  return (
    <div>
      <div className="flex h-32 items-end gap-[3px]">
        {data.map((d) => (
          <div key={d.period} className="group relative flex-1" title={`${d.period}: RM ${(d.revenueCents / 100).toFixed(2)}`}>
            <div className="w-full rounded-t bg-brand-500/80 transition group-hover:bg-brand-600"
              style={{ height: `${Math.max(2, (d.revenueCents / max) * 128)}px` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-ink-400">
        <span>{data[0]?.period.slice(5)}</span>
        <span>{data[data.length - 1]?.period.slice(5)}</span>
      </div>
    </div>
  );
}
