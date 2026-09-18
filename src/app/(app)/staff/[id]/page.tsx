"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Badge, Money, Empty, callAction, toast, Field } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { fmtDateTime } from "@/lib/dates";

const DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const iso = (d: Date) => d.toISOString().slice(0, 10);

export default function StaffDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const from = iso(new Date(Date.now() - 90 * 86400000)), to = iso(new Date());
  const list = useAction<any[]>("staff.list", { includeInactive: true });
  const hist = useAction<any>("staff.workHistory", { staffId: id, from, to });
  const pay = useAction<any>("payroll.calculate", { from, to, staffId: id });

  const s = list.data?.find((x) => x.id === id);
  const [saving, setSaving] = useState(false);

  async function toggleDay(weekday: number) {
    if (!s) return;
    const has = s.availability.some((a: any) => a.weekday === weekday);
    const slots = has
      ? s.availability.filter((a: any) => a.weekday !== weekday).map((a: any) => ({ weekday: a.weekday, startMin: a.startMin, endMin: a.endMin }))
      : [...s.availability.map((a: any) => ({ weekday: a.weekday, startMin: a.startMin, endMin: a.endMin })), { weekday, startMin: 480, endMin: 1080 }];
    setSaving(true);
    try { await callAction("staff.setAvailability", { staffId: id, slots }); list.refresh(); toast("Availability updated"); }
    catch (e: any) { toast(e.message, "err"); } finally { setSaving(false); }
  }

  if (list.loading) return <p className="text-sm text-ink-400">{t("common.loading")}</p>;
  if (!s) return <Empty text="Cleaner not found" />;
  const line = pay.data?.lines?.[0];

  return (
    <div className="space-y-4">
      <PageHeader title={s.name} subtitle={s.phone ?? s.email ?? undefined}
        actions={<Link href="/staff" className="btn-outline btn-sm">{t("common.back")}</Link>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card card-pad"><p className="text-xs text-ink-400">Jobs (90d)</p><p className="mt-1 text-2xl font-semibold">{hist.data?.jobsAssigned ?? 0}</p></div>
        <div className="card card-pad"><p className="text-xs text-ink-400">{t("dash.completed")}</p><p className="mt-1 text-2xl font-semibold text-emerald-600">{hist.data?.jobsCompleted ?? 0}</p></div>
        <div className="card card-pad"><p className="text-xs text-ink-400">Hours</p><p className="mt-1 text-2xl font-semibold">{hist.data?.totalHours ?? 0}</p></div>
        <div className="card card-pad"><p className="text-xs text-ink-400">Earned (90d)</p><p className="mt-1 truncate text-xl font-semibold sm:text-2xl"><Money cents={line?.earnedCents ?? 0} /></p></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card card-pad">
          <p className="section-title mb-3">Weekly availability</p>
          <div className="space-y-1.5">
            {DAYS.map((d, i) => {
              const slot = s.availability.find((a: any) => a.weekday === i);
              return (
                <button key={d} onClick={() => toggleDay(i)} disabled={saving}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-xs transition ${
                    slot ? "border-brand-200 bg-brand-50 text-brand-700" : "border-ink-100 text-ink-400 hover:bg-ink-50"}`}>
                  <span className="font-medium">{d}</span>
                  <span className="tabular-nums">{slot ? `${String(Math.floor(slot.startMin/60)).padStart(2,"0")}:00 – ${String(Math.floor(slot.endMin/60)).padStart(2,"0")}:00` : "Off"}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-ink-400">Default shift is 08:00–18:00. Tap a day to toggle it.</p>
        </div>

        <div className="card lg:col-span-2">
          <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">Assigned jobs</p></div>
          <div className="max-h-[28rem] divide-y divide-ink-50 overflow-y-auto">
            {!hist.data?.jobs?.length ? <Empty text={t("common.empty")} /> : hist.data.jobs.map((j: any) => (
              <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-ink-50">
                <div><p className="text-sm font-medium text-ink-800">{j.customer}</p>
                  <p className="text-[11px] text-ink-400">{j.ref} · {fmtDateTime(new Date(j.scheduledAt))}</p></div>
                <Badge status={j.status} label={t(`job.status.${j.status}`)} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
