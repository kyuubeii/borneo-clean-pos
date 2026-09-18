"use client";
import { useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Modal, Field, callAction, toast, Money, Empty } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { toCents } from "@/lib/money";

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export default function Staff() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const { data, loading, refresh } = useAction<any[]>("staff.list", { includeInactive: true });

  return (
    <div>
      <PageHeader title={t("nav.staff")} subtitle={`${data?.filter((s) => s.active).length ?? 0} ${t("common.active")}`}
        actions={<button onClick={() => setOpen(true)} className="btn-primary btn-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          {t("common.new")}</button>} />

      {loading ? <p className="text-sm text-ink-400">{t("common.loading")}</p>
      : !data?.length ? <Empty text={t("common.empty")} />
      : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((s) => (
            <Link key={s.id} href={`/staff/${s.id}`} className={`card card-pad transition hover:shadow-md ${s.active ? "" : "opacity-50"}`}>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{ background: s.colour }}>{s.name.split(" ").map((x: string) => x[0]).slice(0, 2).join("")}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-900">{s.name}</p>
                  <p className="truncate text-[11px] text-ink-400">{s.phone ?? s.email ?? "—"}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-ink-50 pt-2.5 text-xs">
                <span className="text-ink-400">
                  {s.payType === "HOURLY" ? "Hourly" : s.payType === "PER_JOB" ? "Per job" : "Commission"}
                </span>
                <span className="font-medium text-ink-700">
                  {s.payType === "PERCENT" ? `${s.payRate / 100}%` : <><Money cents={s.payRate} />{s.payType === "HOURLY" ? " /hr" : " /job"}</>}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {DAYS.map((d, i) => {
                  const on = s.availability?.some((a: any) => a.weekday === i);
                  return <span key={d} className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${on ? "bg-brand-50 text-brand-600" : "bg-ink-50 text-ink-300"}`}>{d}</span>;
                })}
              </div>
            </Link>
          ))}
        </div>}

      <StaffForm open={open} onClose={() => setOpen(false)} onDone={refresh} />
    </div>
  );
}

function StaffForm({ open, onClose, onDone }: any) {
  const t = useT();
  const [f, setF] = useState<any>({ name: "", phone: "", email: "", payType: "HOURLY", rate: "18.00", colour: "#3385fb" });
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function save() {
    if (!f.name.trim()) return toast("Name is required", "err");
    setBusy(true);
    try {
      await callAction("staff.create", { name: f.name, phone: f.phone || undefined, email: f.email || undefined,
        payType: f.payType, colour: f.colour,
        payRate: f.payType === "PERCENT" ? Math.round(parseFloat(f.rate || "0") * 100) : toCents(f.rate || 0) });
      toast("Cleaner added"); onDone(); onClose();
      setF({ name: "", phone: "", email: "", payType: "HOURLY", rate: "18.00", colour: "#3385fb" });
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="New cleaner">
      <div className="space-y-3">
        <Field label={t("common.name")}><input className="input" value={f.name} onChange={set("name")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.phone")}><input className="input" value={f.phone} onChange={set("phone")} /></Field>
          <Field label={t("common.email")}><input className="input" value={f.email} onChange={set("email")} /></Field>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Pay type">
              <select className="input" value={f.payType} onChange={set("payType")}>
                <option value="HOURLY">Hourly rate</option>
                <option value="PER_JOB">Fixed per job</option>
                <option value="PERCENT">Percentage of job value</option>
              </select>
            </Field>
          </div>
          <Field label={f.payType === "PERCENT" ? "Percent" : "Rate (RM)"}>
            <input className="input" inputMode="decimal" value={f.rate} onChange={set("rate")} />
          </Field>
        </div>
        <Field label="Calendar colour">
          <input type="color" className="h-9 w-20 cursor-pointer rounded border border-ink-200" value={f.colour} onChange={set("colour")} />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={save} disabled={busy} className="btn-primary">{busy ? t("common.saving") : t("common.create")}</button>
        </div>
      </div>
    </Modal>
  );
}
