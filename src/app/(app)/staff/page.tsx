"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Modal, Field, callAction, toast, Money, Empty, ConfirmDelete, humanError } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { useCan, ADMIN_UP } from "@/components/UserProvider";
import { toCents } from "@/lib/money";

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export default function Staff() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const manage = useCan(ADMIN_UP);
  const { data, loading, refresh } = useAction<any[]>("staff.list", { includeInactive: true });

  /** Freeze / unfreeze. Keeps every job, hour and payout the cleaner is attached to. */
  async function setActive(s: any, active: boolean) {
    setBusyId(s.id);
    try {
      await callAction("staff.update", { staffId: s.id, active });
      toast(active ? `${s.name} reactivated` : `${s.name} deactivated \u2014 history kept`);
      refresh();
    } catch (e: any) { toast(humanError(e.message), "err"); } finally { setBusyId(null); }
  }

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
            <div key={s.id} className={`card card-pad transition hover:shadow-md ${s.active ? "" : "opacity-60"}`}>
              <Link href={`/staff/${s.id}`} className="block">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                  style={{ background: s.colour }}>{s.name.split(" ").map((x: string) => x[0]).slice(0, 2).join("")}</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-900">
                    {s.name}
                    {!s.active && <span className="ml-1.5 rounded bg-ink-100 px-1.5 py-0.5 align-middle text-[9px] font-semibold uppercase tracking-wide text-ink-500">Inactive</span>}
                  </p>
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
              {manage && (
                <div className="mt-2.5 flex items-center gap-1.5 border-t border-ink-50 pt-2.5">
                  <button onClick={() => setEditing(s)} className="btn-outline btn-sm flex-1">{t("common.edit")}</button>
                  <button onClick={() => setActive(s, !s.active)} disabled={busyId === s.id}
                    className="btn-outline btn-sm flex-1 disabled:opacity-50">
                    {s.active ? "Deactivate" : "Reactivate"}
                  </button>
                  <button onClick={() => setDeleting(s)} title="Delete permanently"
                    className="rounded-lg border border-ink-200 p-1.5 text-ink-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>}

      <StaffForm open={open} onClose={() => setOpen(false)} onDone={refresh} />
      <StaffForm open={!!editing} initial={editing} onClose={() => setEditing(null)} onDone={refresh} />

      <ConfirmDelete
        open={!!deleting} onClose={() => setDeleting(null)} onDone={refresh}
        title="Delete cleaner permanently"
        action="staff.delete" input={{ staffId: deleting?.id }}
        confirmText={deleting?.name} confirmLabel="the cleaner\u2019s name">
        <strong>{deleting?.name}</strong> is removed for good, along with their weekly
        availability. This cannot be undone.
        <br /><br />
        It only works for a cleaner who has never been assigned a job. Once there is any
        work history, the record has to be kept so past jobs and payroll still add up.
      </ConfirmDelete>
    </div>
  );
}

const BLANK_STAFF = { name: "", phone: "", email: "", payType: "HOURLY", rate: "18.00", colour: "#3385fb" };

/** Create when `initial` is absent, edit when it is there. */
function StaffForm({ open, onClose, onDone, initial }: any) {
  const t = useT();
  const [f, setF] = useState<any>(BLANK_STAFF);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  // Load the record being edited, and reset when the form is reused for a new one.
  useEffect(() => {
    if (!open) return;
    setF(initial
      ? { name: initial.name, phone: initial.phone ?? "", email: initial.email ?? "",
          payType: initial.payType, colour: initial.colour,
          rate: initial.payType === "PERCENT" ? String(initial.payRate / 100) : (initial.payRate / 100).toFixed(2) }
      : BLANK_STAFF);
  }, [open, initial]);

  async function save() {
    if (!f.name.trim()) return toast("Name is required", "err");
    setBusy(true);
    const payload = {
      name: f.name, phone: f.phone || undefined, email: f.email || undefined,
      payType: f.payType, colour: f.colour,
      payRate: f.payType === "PERCENT" ? Math.round(parseFloat(f.rate || "0") * 100) : toCents(f.rate || 0),
    };
    try {
      if (initial) {
        await callAction("staff.update", { staffId: initial.id, ...payload });
        toast("Cleaner updated");
      } else {
        await callAction("staff.create", payload);
        toast("Cleaner added");
      }
      onDone(); onClose();
    } catch (e: any) { toast(humanError(e.message), "err"); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? `Edit ${initial.name}` : "New cleaner"}>
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
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? t("common.saving") : initial ? t("common.save") : t("common.create")}</button>
        </div>
      </div>
    </Modal>
  );
}
