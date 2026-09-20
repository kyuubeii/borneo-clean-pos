"use client";
import { useState } from "react";
import { useT, useI18n } from "@/components/I18nProvider";
import { useAction, Modal, Field, callAction, toast, Money, Empty, ConfirmDelete, humanError } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { useCan, ADMIN_UP } from "@/components/UserProvider";
import { minsToLabel } from "@/lib/dates";
import { toCents } from "@/lib/money";

export default function Services() {
  const t = useT();
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const manage = useCan(ADMIN_UP);
  const { data, loading, refresh } = useAction<any[]>("services.list", { includeInactive: true });

  /** The ServiceForm already edits `active`; this is the one-click version. */
  async function setActive(sv: any, active: boolean) {
    try {
      await callAction("services.update", { serviceId: sv.id, active });
      toast(active ? `${sv.name} reactivated` : `${sv.name} deactivated \u2014 existing bookings keep their price`);
      refresh();
    } catch (e: any) { toast(humanError(e.message), "err"); }
  }

  const main = (data ?? []).filter((s) => !s.isAddon);
  const addons = (data ?? []).filter((s) => s.isAddon);

  return (
    <div>
      <PageHeader title={t("nav.services")} subtitle="Catalogue, pricing and duration"
        actions={<button onClick={() => { setEdit(null); setOpen(true); }} className="btn-primary btn-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          {t("common.new")}</button>} />

      {loading ? <p className="text-sm text-ink-400">{t("common.loading")}</p> : (
        <div className="space-y-4">
          <Group title="Services" rows={main} locale={locale} manage={manage}
            onEdit={(s: any) => { setEdit(s); setOpen(true); }} onToggle={setActive} onDelete={setDeleting} />
          <Group title="Add-ons" rows={addons} locale={locale} manage={manage}
            onEdit={(s: any) => { setEdit(s); setOpen(true); }} onToggle={setActive} onDelete={setDeleting} />
        </div>
      )}

      <ServiceForm open={open} onClose={() => setOpen(false)} onDone={refresh} initial={edit} />

      <ConfirmDelete
        open={!!deleting} onClose={() => setDeleting(null)} onDone={refresh}
        title="Delete service permanently"
        action="services.delete" input={{ serviceId: deleting?.id }}
        confirmText={deleting?.name} confirmLabel="the service name"
        alternative={<>To retire it from new bookings while keeping past ones intact, close this and use <strong>Deactivate</strong>.</>}>
        <strong>{deleting?.name}</strong> is removed from the catalogue for good.
        This cannot be undone.
        <br /><br />
        It only works for a service that has never been booked or quoted. Once it appears
        on any record, it has to stay so those prices still make sense.
      </ConfirmDelete>
    </div>
  );
}

function Group({ title, rows, onEdit, onToggle, onDelete, locale, manage }: any) {
  const t = useT();
  if (!rows.length) return null;
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">{title}</p></div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px]">
          <thead className="border-b border-ink-100 bg-ink-50/50">
            <tr><th className="th">{t("common.name")}</th><th className="th">Category</th>
              <th className="th">{t("common.duration")}</th><th className="th text-right">Materials</th>
              <th className="th text-right">{t("common.price")}</th><th className="th"></th></tr>
          </thead>
          <tbody className="divide-y divide-ink-50">
            {rows.map((s: any) => (
              <tr key={s.id} className={s.active ? "" : "opacity-50"}>
                <td className="td">
                  <p className="font-medium text-ink-900">{locale === "zh" && s.nameZh ? s.nameZh : s.name}</p>
                  {s.description && <p className="text-[11px] text-ink-400">{s.description}</p>}
                </td>
                <td className="td"><span className="badge bg-ink-100 text-ink-600">{s.category}</span></td>
                <td className="td text-ink-500">{minsToLabel(s.durationMin)}</td>
                <td className="td text-right text-ink-400"><Money cents={s.materialCostCents} /></td>
                <td className="td text-right font-medium text-ink-900"><Money cents={s.priceCents} /></td>
                <td className="td text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    <button onClick={() => onEdit(s)} className="btn-ghost btn-sm">{t("common.edit")}</button>
                    {manage && (
                      <>
                        <button onClick={() => onToggle(s, !s.active)} className="btn-outline btn-sm whitespace-nowrap">
                          {s.active ? "Deactivate" : "Reactivate"}
                        </button>
                        <button onClick={() => onDelete(s)} title="Delete permanently"
                          className="rounded-lg border border-ink-200 p-1.5 text-ink-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ServiceForm({ open, onClose, onDone, initial }: any) {
  const t = useT();
  const blank = { name: "", nameZh: "", category: "Residential", price: "", durationMin: 120, material: "", isAddon: false, description: "", active: true };
  const [f, setF] = useState<any>(blank);
  const [busy, setBusy] = useState(false);
  const [seeded, setSeeded] = useState<string | null>(null);

  // Load the record being edited the first time the modal opens for it.
  if (open && initial && seeded !== initial.id) {
    setSeeded(initial.id);
    setF({ name: initial.name, nameZh: initial.nameZh ?? "", category: initial.category,
      price: (initial.priceCents / 100).toFixed(2), durationMin: initial.durationMin,
      material: (initial.materialCostCents / 100).toFixed(2), isAddon: initial.isAddon,
      description: initial.description ?? "", active: initial.active });
  }
  if (open && !initial && seeded !== null) { setSeeded(null); setF(blank); }

  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  async function save() {
    if (!f.name.trim()) return toast("Name is required", "err");
    setBusy(true);
    try {
      const payload = { name: f.name, nameZh: f.nameZh || undefined, category: f.category,
        priceCents: toCents(f.price || 0), durationMin: Number(f.durationMin) || 120,
        materialCostCents: toCents(f.material || 0), description: f.description || undefined };
      if (initial) await callAction("services.update", { serviceId: initial.id, ...payload, active: f.active });
      else await callAction("services.create", { ...payload, isAddon: f.isAddon });
      toast(initial ? "Service updated" : "Service created"); onDone(); onClose();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? `${t("common.edit")} service` : "New service"}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.name")}><input className="input" value={f.name} onChange={set("name")} /></Field>
          <Field label="名称 (中文)"><input className="input" value={f.nameZh} onChange={set("nameZh")} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className="input" value={f.category} onChange={set("category")}>
              {["Residential","Commercial","Specialty","Add-on","General"].map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label={`${t("common.duration")} (minutes)`}><input className="input" type="number" value={f.durationMin} onChange={set("durationMin")} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("common.price")} (RM)`}><input className="input" inputMode="decimal" value={f.price} onChange={set("price")} placeholder="150.00" /></Field>
          <Field label="Material cost (RM)"><input className="input" inputMode="decimal" value={f.material} onChange={set("material")} placeholder="15.00" /></Field>
        </div>
        <Field label={`Description (${t("common.optional")})`}><textarea className="input" rows={2} value={f.description} onChange={set("description")} /></Field>
        <label className="flex items-center gap-2 text-sm text-ink-600">
          {initial ? <><input type="checkbox" checked={f.active} onChange={set("active")} /> Active</>
                   : <><input type="checkbox" checked={f.isAddon} onChange={set("isAddon")} /> This is an add-on</>}
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={save} disabled={busy} className="btn-primary">{busy ? t("common.saving") : t("common.save")}</button>
        </div>
      </div>
    </Modal>
  );
}
