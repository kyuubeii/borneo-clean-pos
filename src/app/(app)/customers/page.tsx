"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Modal, Field, callAction, toast, Empty, ConfirmDelete, humanError } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { useCan, ADMIN_UP, OWNER_ONLY } from "@/components/UserProvider";

export default function Customers() {
  const t = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [deleting, setDeleting] = useState<any>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const canEdit = useCan(ADMIN_UP);
  // customers.delete is OWNER-only in the registry; gate the button the same way.
  const canDelete = useCan(OWNER_ONLY);
  const { data, loading, refresh } = useAction<any[]>("customers.search", { query: q || undefined, limit: 50, includeInactive: true });

  async function setActive(c: any, active: boolean) {
    setBusyId(c.id);
    try {
      await callAction("customers.update", { customerId: c.id, active });
      toast(active ? `${c.name} reactivated` : `${c.name} deactivated \u2014 history kept`);
      refresh();
    } catch (e: any) { toast(humanError(e.message), "err"); } finally { setBusyId(null); }
  }

  return (
    <div>
      <PageHeader title={t("nav.customers")} subtitle={`${data?.length ?? 0} ${t("nav.customers").toLowerCase()}`}
        actions={<button onClick={() => setOpen(true)} className="btn-primary btn-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          {t("common.new")}</button>} />

      <div className="mb-3">
        <input className="input max-w-sm" placeholder={`${t("common.search")}…`} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        {loading ? <p className="p-4 text-sm text-ink-400">{t("common.loading")}</p>
        : !data?.length ? <Empty text={t("common.empty")} />
        : <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-ink-100 bg-ink-50/50">
                <tr><th className="th">{t("common.name")}</th><th className="th">{t("common.phone")}</th>
                  <th className="th">{t("common.email")}</th><th className="th">{t("common.address")}</th>
                  {canEdit && <th className="th w-px whitespace-nowrap text-right">{t("common.actions")}</th>}</tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {data.map((c) => (
                  <tr key={c.id} className="row-link" onClick={() => location.assign(`/customers/${c.id}`)}>
                    <td className="td">
                      <Link href={`/customers/${c.id}`} className="font-medium text-ink-900 hover:text-brand-600">{c.name}</Link>
                      {c.active === false && <span className="ml-1.5 rounded bg-ink-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-500">Inactive</span>}
                      {c.company && <p className="text-[11px] text-ink-400">{c.company}</p>}
                    </td>
                    <td className="td tabular-nums">{c.phone ?? "—"}</td>
                    <td className="td text-ink-500">{c.email ?? "—"}</td>
                    <td className="td text-ink-500">{c.addresses[0]?.line1 ?? "—"}
                      {c.addresses.length > 1 && <span className="ml-1 text-[11px] text-ink-300">+{c.addresses.length - 1}</span>}</td>
                    {canEdit && (
                      // stopPropagation: the whole row navigates on click.
                      <td className="td text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => setEditing(c)} className="btn-outline btn-sm">{t("common.edit")}</button>
                          <button onClick={() => setActive(c, c.active === false)} disabled={busyId === c.id}
                            className="btn-outline btn-sm whitespace-nowrap disabled:opacity-50">
                            {c.active === false ? "Reactivate" : "Deactivate"}
                          </button>
                          {canDelete && (
                            <button onClick={() => setDeleting(c)} title="Delete permanently"
                              className="rounded-lg border border-ink-200 p-1.5 text-ink-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </div>

      <NewCustomer open={open} onClose={() => setOpen(false)} onDone={refresh} />
      <NewCustomer open={!!editing} initial={editing} onClose={() => setEditing(null)} onDone={refresh} />

      <ConfirmDelete
        open={!!deleting} onClose={() => setDeleting(null)} onDone={refresh}
        title="Delete customer permanently"
        action="customers.delete" input={{ customerId: deleting?.id }}
        confirmText={deleting?.name} confirmLabel="the customer\u2019s name"
        alternative={<>To stop them appearing on new bookings without losing anything, close this and use <strong>Deactivate</strong>.</>}>
        <strong>{deleting?.name}</strong> and their saved addresses are removed for good.
        This cannot be undone.
        <br /><br />
        It only works for a customer with no bookings, jobs or invoices. Once there is any
        history, the record has to stay so past work and takings still add up.
      </ConfirmDelete>
    </div>
  );
}

const BLANK_CUSTOMER = { name: "", phone: "", email: "", company: "", line1: "", city: "Kuching", notes: "" };

/** Create when `initial` is absent, edit when it is there. */
function NewCustomer({ open, onClose, onDone, initial }: { open: boolean; onClose: () => void; onDone: () => void; initial?: any }) {
  const t = useT();
  const [f, setF] = useState<any>(BLANK_CUSTOMER);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!open) return;
    setF(initial
      ? { name: initial.name, phone: initial.phone ?? "", email: initial.email ?? "",
          company: initial.company ?? "", notes: initial.notes ?? "",
          line1: initial.addresses?.[0]?.line1 ?? "", city: initial.addresses?.[0]?.city ?? "Kuching" }
      : BLANK_CUSTOMER);
  }, [open, initial]);

  async function save() {
    if (!f.name.trim()) return toast("Name is required", "err");
    setBusy(true);
    try {
      if (initial) {
        // Addresses are their own records with their own actions; this form edits
        // the customer, and the address fields stay read-only on an existing one.
        await callAction("customers.update", {
          customerId: initial.id, name: f.name, phone: f.phone || undefined, email: f.email || undefined,
          company: f.company || undefined, notes: f.notes || undefined,
        });
        toast("Customer updated");
      } else {
        await callAction("customers.create", {
          name: f.name, phone: f.phone || undefined, email: f.email || undefined,
          company: f.company || undefined, notes: f.notes || undefined,
          address: f.line1 ? { label: "Home", line1: f.line1, city: f.city } : undefined,
        });
        toast("Customer created");
      }
      onDone(); onClose();
    } catch (e: any) { toast(humanError(e.message), "err"); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? `Edit ${initial.name}` : `${t("common.new")} ${t("common.customer").toLowerCase()}`}>
      <div className="space-y-3">
        <Field label={t("common.name")}><input className="input" value={f.name} onChange={set("name")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.phone")}><input className="input" value={f.phone} onChange={set("phone")} /></Field>
          <Field label={t("common.email")}><input className="input" value={f.email} onChange={set("email")} /></Field>
        </div>
        <Field label={`Company (${t("common.optional")})`}><input className="input" value={f.company} onChange={set("company")} /></Field>
        {!initial && (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><Field label={t("common.address")}><input className="input" value={f.line1} onChange={set("line1")} /></Field></div>
            <Field label="City"><input className="input" value={f.city} onChange={set("city")} /></Field>
          </div>
        )}
        {initial && <p className="text-[11px] text-ink-400">Addresses are managed on the customer\u2019s own page.</p>}
        <Field label={t("common.notes")}><textarea className="input" rows={2} value={f.notes} onChange={set("notes")} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? t("common.saving") : initial ? t("common.save") : t("common.create")}</button>
        </div>
      </div>
    </Modal>
  );
}
