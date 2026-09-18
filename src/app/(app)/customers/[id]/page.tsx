"use client";
import { use } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Badge, Money, Empty } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { fmtDateTime, fmtDate } from "@/lib/dates";

export default function CustomerDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const { data: c, loading } = useAction<any>("customers.get", { customerId: id });

  if (loading) return <p className="text-sm text-ink-400">{t("common.loading")}</p>;
  if (!c) return <Empty text="Customer not found" />;

  const totalPaid = c.payments.reduce((a: number, p: any) => a + (p.isRefund ? -p.amountCents : p.amountCents), 0);
  const outstanding = c.invoices.reduce((a: number, i: any) => {
    const sub = i.items.reduce((x: number, it: any) => x + it.qty * it.priceCents, 0) - i.discountCents;
    const paid = i.payments.reduce((x: number, p: any) => x + (p.isRefund ? -p.amountCents : p.amountCents), 0);
    return i.status === "VOID" ? a : a + Math.max(0, sub - paid);
  }, 0);

  return (
    <div className="space-y-4">
      <PageHeader title={c.name} subtitle={c.company ?? undefined}
        actions={<Link href="/customers" className="btn-outline btn-sm">{t("common.back")}</Link>} />

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
          <p className="section-title mb-3">Service addresses</p>
          <div className="space-y-2">
            {c.addresses.map((a: any) => (
              <div key={a.id} className="rounded-lg border border-ink-100 p-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-ink-700">{a.label}</span>
                  {a.isPrimary && <span className="badge bg-brand-50 text-brand-600">Primary</span>}
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
