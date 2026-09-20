"use client";
import { use, useState } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Badge, Money, Empty, callAction, toast, humanError, ConfirmDelete } from "@/components/ui";
import { CustomerForm, AddressForm } from "@/components/CustomerForm";
import PageHeader from "@/components/PageHeader";
import { useCan, ADMIN_UP } from "@/components/UserProvider";
import { fmtDateTime, fmtDate } from "@/lib/dates";

export default function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const { data: c, loading, refresh } = useAction<any>("customers.get", { customerId: id });
  // customers.update / addAddress / updateAddress / deleteAddress are all
  // ADMIN_UP in the registry. Only customers.delete is owner-only, and that
  // stays on the list screen.
  const canEdit = useCan(ADMIN_UP);

  const [editing, setEditing] = useState(false);
  const [addingAddress, setAddingAddress] = useState(false);
  const [editingAddress, setEditingAddress] = useState<any>(null);
  const [deletingAddress, setDeletingAddress] = useState<any>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (loading) return <p className="text-sm text-ink-400">{t("common.loading")}</p>;
  if (!c) return <Empty text="Customer not found" />;

  async function makePrimary(a: any) {
    setBusyId(a.id);
    try {
      await callAction("customers.updateAddress", { addressId: a.id, isPrimary: true });
      toast(`${a.label} is now the primary address`);
      refresh();
    } catch (e: any) { toast(humanError(e.message), "err"); } finally { setBusyId(null); }
  }

  async function setActive(active: boolean) {
    setBusyId(c.id);
    try {
      await callAction("customers.update", { customerId: c.id, active });
      toast(active ? `${c.name} reactivated` : `${c.name} deactivated — history kept`);
      refresh();
    } catch (e: any) { toast(humanError(e.message), "err"); } finally { setBusyId(null); }
  }

  const totalPaid = c.payments.reduce((a: number, p: any) => a + (p.isRefund ? -p.amountCents : p.amountCents), 0);
  const outstanding = c.invoices.reduce((a: number, i: any) => {
    const sub = i.items.reduce((x: number, it: any) => x + it.qty * it.priceCents, 0) - i.discountCents;
    const paid = i.payments.reduce((x: number, p: any) => x + (p.isRefund ? -p.amountCents : p.amountCents), 0);
    return i.status === "VOID" ? a : a + Math.max(0, sub - paid);
  }, 0);

  return (
    <div className="space-y-4">
      <PageHeader title={c.name} subtitle={c.company ?? undefined}
        actions={<>
          {canEdit && <>
            <button onClick={() => setEditing(true)} className="btn-outline btn-sm">{t("common.edit")}</button>
            <button onClick={() => setActive(c.active === false)} disabled={busyId === c.id}
              className="btn-outline btn-sm whitespace-nowrap disabled:opacity-50">
              {c.active === false ? "Reactivate" : "Deactivate"}
            </button>
          </>}
          <Link href="/customers" className="btn-outline btn-sm">{t("common.back")}</Link>
        </>} />

      {c.active === false && (
        <div className="rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-600">
          <strong>Deactivated.</strong> Everything here is kept, but this customer no longer
          appears when you start a new booking or quote.
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card card-pad">
          <p className="section-title mb-3">Contact</p>
          <dl className="space-y-2 text-sm">
            <Row k={t("common.phone")} v={c.phone} />
            <Row k={t("common.email")} v={c.email} />
            <Row k="Customer since" v={fmtDate(new Date(c.createdAt))} />
            <Row k="Lifetime paid" v={<Money cents={totalPaid} />} />
            <Row k={t("dash.outstanding")} v={<Money cents={outstanding} className={outstanding > 0 ? "text-amber-600 font-medium" : ""} />} />
          </dl>
          {c.notes && <div className="mt-3 rounded-lg bg-ink-50 p-2.5 text-xs text-ink-600">{c.notes}</div>}
        </div>

        <div className="card card-pad lg:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="section-title">Service addresses</p>
            {canEdit && (
              <button onClick={() => setAddingAddress(true)} className="btn-outline btn-sm">
                {t("common.add")}
              </button>
            )}
          </div>
          <div className="space-y-2">
            {!c.addresses.length ? <Empty text="No address on file yet" />
              // Primary first: it is the one a new booking will default to.
              : [...c.addresses].sort((x: any, y: any) => Number(!!y.isPrimary) - Number(!!x.isPrimary)).map((a: any) => (
              <div key={a.id} className="rounded-lg border border-ink-100 p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-ink-700">{a.label}</span>
                    {a.isPrimary && <span className="badge bg-brand-50 text-brand-600">Primary</span>}
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1.5">
                      {!a.isPrimary && (
                        <button onClick={() => makePrimary(a)} disabled={busyId === a.id}
                          className="btn-outline btn-sm whitespace-nowrap disabled:opacity-50">Make primary</button>
                      )}
                      <button onClick={() => setEditingAddress(a)} className="btn-outline btn-sm">{t("common.edit")}</button>
                      <button onClick={() => setDeletingAddress(a)} title="Remove this address"
                        className="rounded-lg border border-ink-200 p-1.5 text-ink-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                      </button>
                    </div>
                  )}
                </div>
                <p className="mt-0.5 text-sm text-ink-600">{[a.line1, a.line2, a.city, a.postcode, a.state].filter(Boolean).join(", ")}</p>
                {a.accessNotes && <p className="mt-1 text-[11px] text-ink-400">🔑 {a.accessNotes}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`${t("nav.jobs")} (${c.jobs.length})`}>
          {!c.jobs.length ? <Empty text={t("common.empty")} /> : c.jobs.slice(0, 10).map((j: any) => (
            <Link key={j.id} href={`/jobs/${j.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-ink-50">
              <div><p className="text-sm font-medium text-ink-800">{j.ref}</p>
                <p className="text-[11px] text-ink-400">{fmtDateTime(new Date(j.scheduledAt))}</p></div>
              <div className="flex items-center gap-2"><Money cents={j.revenueCents} className="text-xs text-ink-500" />
                <Badge status={j.status} label={t(`job.status.${j.status}`)} /></div>
            </Link>
          ))}
        </Panel>

        <Panel title={`${t("nav.invoices")} (${c.invoices.length})`}>
          {!c.invoices.length ? <Empty text={t("common.empty")} /> : c.invoices.slice(0, 10).map((i: any) => {
            const sub = i.items.reduce((x: number, it: any) => x + it.qty * it.priceCents, 0) - i.discountCents;
            return (
              <Link key={i.id} href={`/invoices/${i.id}`} className="flex items-center justify-between px-4 py-2.5 hover:bg-ink-50">
                <div><p className="text-sm font-medium text-ink-800">{i.ref}</p>
                  <p className="text-[11px] text-ink-400">{fmtDate(new Date(i.issuedAt))}</p></div>
                <div className="flex items-center gap-2"><Money cents={sub} className="text-xs text-ink-500" />
                  <Badge status={i.status} label={t(`inv.status.${i.status}`)} /></div>
              </Link>
            );
          })}
        </Panel>
      </div>

      <CustomerForm open={editing} initial={editing ? c : undefined}
        onClose={() => setEditing(false)} onDone={refresh} />
      <AddressForm open={addingAddress} customerId={c.id}
        onClose={() => setAddingAddress(false)} onDone={refresh} />
      <AddressForm open={!!editingAddress} customerId={c.id} initial={editingAddress}
        onClose={() => setEditingAddress(null)} onDone={refresh} />

      <ConfirmDelete
        open={!!deletingAddress} onClose={() => setDeletingAddress(null)} onDone={refresh}
        title="Remove this address"
        action="customers.deleteAddress" input={{ addressId: deletingAddress?.id }}
        verb="Remove">
        <strong>{deletingAddress?.label}</strong> &mdash; {deletingAddress?.line1} &mdash; is removed
        from {c.name}&rsquo;s record.
        <br /><br />
        It only works while nothing points at it. Once a booking or a job has happened there,
        the address has to stay so past work still says where it was done &mdash; edit it instead.
      </ConfirmDelete>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: any }) => (
  <div className="flex items-baseline justify-between gap-3">
    <dt className="text-xs text-ink-400">{k}</dt><dd className="text-right text-ink-700">{v ?? "—"}</dd>
  </div>
);

const Panel = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="card">
    <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">{title}</p></div>
    <div className="max-h-96 divide-y divide-ink-50 overflow-y-auto">{children}</div>
  </div>
);
