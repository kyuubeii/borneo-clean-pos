"use client";
import { useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { LoadError, useAction, callAction, toast, Empty, ConfirmDelete, humanError } from "@/components/ui";
import { CustomerForm } from "@/components/CustomerForm";
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
  const { data, loading, error, refresh } = useAction<any[]>("customers.search", { query: q || undefined, limit: 50, includeInactive: true });

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
      <LoadError error={error} onRetry={refresh} />
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

      <CustomerForm open={open} onClose={() => setOpen(false)} onDone={refresh} />
      <CustomerForm open={!!editing} initial={editing} onClose={() => setEditing(null)} onDone={refresh} />

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
