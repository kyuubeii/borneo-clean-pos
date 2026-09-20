"use client";
import Link from "next/link";
import { useT } from "./I18nProvider";
import { useAction, Badge, Money, Empty, Stat, callAction, toast } from "./ui";
import PageHeader from "./PageHeader";
import { fmtTime, fmtDate, minsToLabel } from "@/lib/dates";
import { useCurrentUser } from "./UserProvider";

/** What a cleaner sees: their own day, not the business's books. */
export default function StaffDashboard() {
  const t = useT();
  const me = useCurrentUser();
  const { data, loading, refresh } = useAction<any>("reports.myDay", {});

  async function toggle(jobId: string, checkedIn: boolean) {
    if (!me.staffId) return toast("No cleaner profile linked to your account", "err");
    try {
      const r = await callAction(checkedIn ? "staff.checkOut" : "staff.checkIn", { jobId, staffId: me.staffId });
      toast(r?.message ?? (checkedIn ? "Checked out" : "Checked in")); refresh();
    } catch (e: any) { toast(e.message, "err"); }
  }

  if (loading) return <p className="text-sm text-ink-400">{t("common.loading")}</p>;

  return (
    <div className="space-y-4">
      <PageHeader title={`${t("common.today")} · ${data?.staffName ?? me.name}`} subtitle={fmtDate(new Date())} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t("dash.todayJobs")} value={data?.jobsToday ?? 0} sub={`${data?.completedToday ?? 0} ${t("dash.completed").toLowerCase()}`} />
        <Stat label={t("staff.hoursWeek")} value={data?.hoursThisWeek ?? 0} />
        <Stat label={t("staff.earnedWeek")} value={<Money cents={data?.earnedThisWeekCents ?? 0} />} tone="good" />
        <Stat label={t("staff.upcomingJobs")} value={data?.upcomingJobs ?? 0} />
      </div>

      <div className="card">
        <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">{t("dash.todayJobs")}</p></div>
        {!data?.jobs?.length ? <Empty text={t("dash.noJobsToday")} /> : (
          <div className="divide-y divide-ink-50">
            {data.jobs.map((j: any) => {
              const checkedIn = data.checkedInToJobId === j.id;
              return (
                <div key={j.id} className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-900">{j.customer}</p>
                      <p className="text-[11px] text-ink-400">
                        {fmtTime(new Date(j.time))} · {minsToLabel(j.durationMin)} · {j.ref}
                      </p>
                    </div>
                    <Badge status={j.status} label={t(`job.status.${j.status}`)} />
                  </div>
                  {j.address && <p className="mt-1.5 text-xs text-ink-500">📍 {j.address}</p>}
                  {j.checklistTotal > 0 && (
                    <p className="mt-1 text-[11px] text-ink-400">{t("job.checklist")}: {j.checklistDone}/{j.checklistTotal}</p>
                  )}
                  <div className="mt-2.5 flex gap-2">
                    <Link href={`/jobs/${j.id}`} className="btn-outline btn-sm flex-1">{t("common.view")}</Link>
                    {j.status !== "COMPLETED" && j.status !== "CANCELLED" && (
                      <button onClick={() => toggle(j.id, checkedIn)} className={`${checkedIn ? "btn-outline" : "btn-primary"} btn-sm flex-1`}>
                        {checkedIn ? t("job.checkOut") : t("job.checkIn")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
