"use client";
import { useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Modal, Field, callAction, toast, Empty } from "@/components/ui";
import PageHeader from "@/components/PageHeader";

export default function Customers() {
  const t = useT();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const { data, loading, refresh } = useAction<any[]>("customers.search", { query: q || undefined, limit: 50 });

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
                  <th className="th">{t("common.email")}</th><th className="th">{t("common.address")}</th></tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {data.map((c) => (
                  <tr key={c.id} className="row-link" onClick={() => location.assign(`/customers/${c.id}`)}>
                    <td className="td">
                      <Link href={`/customers/${c.id}`} className="font-medium text-ink-900 hover:text-brand-600">{c.name}</Link>
                      {c.company && <p className="text-[11px] text-ink-400">{c.company}</p>}
                    </td>
                    <td className="td tabular-nums">{c.phone ?? "—"}</td>
                    <td className="td text-ink-500">{c.email ?? "—"}</td>
                    <td className="td text-ink-500">{c.addresses[0]?.line1 ?? "—"}
                      {c.addresses.length > 1 && <span className="ml-1 text-[11px] text-ink-300">+{c.addresses.length - 1}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </div>

      <NewCustomer open={open} onClose={() => setOpen(false)} onDone={refresh} />
    </div>
  );
}

function NewCustomer({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [f, setF] = useState<any>({ name: "", phone: "", email: "", company: "", line1: "", city: "Kuching", notes: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function save() {
    if (!f.name.trim()) return toast("Name is required", "err");
    setBusy(true);
    try {
      await callAction("customers.create", {
        name: f.name, phone: f.phone || undefined, email: f.email || undefined,
        company: f.company || undefined, notes: f.notes || undefined,
        address: f.line1 ? { label: "Home", line1: f.line1, city: f.city } : undefined,
      });
      toast("Customer created"); onDone(); onClose();
      setF({ name: "", phone: "", email: "", company: "", line1: "", city: "Kuching", notes: "" });
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={`${t("common.new")} ${t("common.customer").toLowerCase()}`}>
      <div className="space-y-3">
        <Field label={t("common.name")}><input className="input" value={f.name} onChange={set("name")} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("common.phone")}><input className="input" value={f.phone} onChange={set("phone")} /></Field>
          <Field label={t("common.email")}><input className="input" value={f.email} onChange={set("email")} /></Field>
        </div>
        <Field label={`Company (${t("common.optional")})`}><input className="input" value={f.company} onChange={set("company")} /></Field>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2"><Field label={t("common.address")}><input className="input" value={f.line1} onChange={set("line1")} /></Field></div>
          <Field label="City"><input className="input" value={f.city} onChange={set("city")} /></Field>
        </div>
        <Field label={t("common.notes")}><textarea className="input" rows={2} value={f.notes} onChange={set("notes")} /></Field>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={save} disabled={busy} className="btn-primary">{busy ? t("common.saving") : t("common.create")}</button>
        </div>
      </div>
    </Modal>
  );
}
