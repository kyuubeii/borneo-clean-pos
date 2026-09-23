"use client";
import { use, useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Badge, Money, Empty, Modal, Field, callAction, toast } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { fmtDateTime, toInput, minsToLabel, isoDate } from "@/lib/dates";
import { toCents, fmt } from "@/lib/money";
import { useIsStaff } from "@/components/UserProvider";

const NEXT: Record<string, string> = { SCHEDULED: "EN_ROUTE", EN_ROUTE: "IN_PROGRESS", IN_PROGRESS: "COMPLETED" };

export default function JobDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const { data: j, loading, refresh } = useAction<any>("jobs.get", { jobId: id });
  const costing = useAction<any>("jobs.costing", { jobId: id });
  // Costing is a separate query, so anything that moves money has to refresh both.
  const reload = () => { refresh(); costing.refresh(); };
  const [assign, setAssign] = useState(false);
  const [resched, setResched] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [price, setPrice] = useState(false);
  const [move, setMove] = useState(false);
  const [editCosting, setEditCosting] = useState(false);
  const isStaff = useIsStaff();
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<any>, msg: string) {
    setBusy(true);
    // An action that returns its own message knows something the caller does
    // not -- a check-out that turned out to be a mis-tap, for instance.
    try { const r = await fn(); toast(r?.message ?? msg); refresh(); costing.refresh(); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  if (loading) return <p className="text-sm text-ink-400">{t("common.loading")}</p>;
  if (!j) return <Empty text="Job not found" />;

  const done = j.checklist.filter((c: any) => c.done).length;
  const openEntry = j.timeEntries.find((e: any) => !e.endAt);

  return (
    <div className="space-y-4">
      <PageHeader title={j.ref} subtitle={`${j.customer.name} · ${fmtDateTime(new Date(j.scheduledAt))}`}
        actions={<>
          {NEXT[j.status] && (
            <button disabled={busy} onClick={() => run(() => callAction("jobs.updateStatus", { jobId: id, status: NEXT[j.status] }), `Marked ${t(`job.status.${NEXT[j.status]}`)}`)}
              className="btn-primary btn-sm">
              {j.status === "IN_PROGRESS" ? t("job.complete") : `→ ${t(`job.status.${NEXT[j.status]}`)}`}
            </button>
          )}
          {j.status === "COMPLETED" && !j.invoiceId && (
            <button disabled={busy} onClick={() => run(async () => { const r = await callAction("invoices.createFromJob", { jobId: id }); location.assign(`/invoices/${r.invoiceId}`); }, "Invoice created")}
              className="btn-primary btn-sm">Create invoice</button>
          )}
          <button onClick={() => setResched(true)} className="btn-outline btn-sm">{t("bk.reschedule")}</button>
          {!isStaff && <>
            <button onClick={() => setPrice(true)} className="btn-outline btn-sm">Edit amount</button>
            <button onClick={() => setMove(true)} className="btn-outline btn-sm">Change customer</button>
          </>}
          <Link href="/jobs" className="btn-outline btn-sm">{t("common.back")}</Link>
        </>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="card card-pad">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Badge status={j.status} label={t(`job.status.${j.status}`)} />
              {j.invoice && <Link href={`/invoices/${j.invoice.id}`} className="badge bg-brand-50 text-brand-600">{j.invoice.ref}</Link>}
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Row k={t("common.customer")} v={<Link href={`/customers/${j.customerId}`} className="text-brand-600 hover:underline">{j.customer.name}</Link>} />
              <Row k={t("common.phone")} v={j.customer.phone ? <a href={`tel:${j.customer.phone}`} className="text-brand-600">{j.customer.phone}</a> : "—"} />
              <Row k={t("common.address")} v={j.address ? [j.address.line1, j.address.line2, j.address.city, j.address.postcode].filter(Boolean).join(", ") : "—"} />
              <Row k={t("common.duration")} v={minsToLabel(j.durationMin)} />
            </dl>
            {j.address?.accessNotes && <div className="mt-3 rounded-lg bg-ink-50 p-2.5 text-xs text-ink-600">🔑 {j.address.accessNotes}</div>}
            {j.customerInstructions && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              <p className="mb-0.5 font-semibold">{t("job.instructions")}</p>{j.customerInstructions}</div>}
          </div>

          <div className="card">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
              <p className="section-title">{t("job.checklist")}</p>
              <span className="text-xs text-ink-400">{done}/{j.checklist.length}</span>
            </div>
            <div className="divide-y divide-ink-50">
              {!j.checklist.length ? <Empty text={t("common.empty")} /> : j.checklist.map((c: any) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2.5 px-4 py-2.5 hover:bg-ink-50">
                  <input type="checkbox" checked={c.done} disabled={busy}
                    onChange={(e) => run(() => callAction("jobs.toggleChecklistItem", { itemId: c.id, done: e.target.checked }), "Updated")}
                    className="h-4 w-4 rounded border-ink-300 text-brand-600" />
                  <span className={`text-sm ${c.done ? "text-ink-400 line-through" : "text-ink-700"}`}>{c.label}</span>
                </label>
              ))}
            </div>
          </div>

          <Photos job={j} onDone={reload} />

          <div className="card card-pad">
            <div className="mb-3 flex items-center justify-between">
              <p className="section-title">{t("common.notes")}</p>
              <button onClick={() => setNotes(j.staffNotes ?? "")} className="btn-ghost btn-sm">{t("common.edit")}</button>
            </div>
            <div className="space-y-2.5 text-sm">
              <div><p className="text-xs text-ink-400">{t("job.internalNotes")}</p><p className="text-ink-700">{j.internalNotes || "—"}</p></div>
              <div><p className="text-xs text-ink-400">{t("job.staffNotes")}</p><p className="text-ink-700">{j.staffNotes || "—"}</p></div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="card">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
              <p className="section-title">{t("job.cleaners")}</p>
              <button onClick={() => setAssign(true)} className="btn-ghost btn-sm">{t("common.edit")}</button>
            </div>
            <div className="divide-y divide-ink-50">
              {!j.assignments.length ? <p className="px-4 py-5 text-center text-xs text-amber-600">{t("cal.unassigned")}</p>
              : j.assignments.map((a: any) => {
                const mine = j.timeEntries.filter((e: any) => e.staffId === a.staffId);
                const mins = mine.reduce((x: number, e: any) => x + (e.endAt ? (new Date(e.endAt).getTime() - new Date(e.startAt).getTime()) / 60000 : 0), 0);
                const isOpen = mine.some((e: any) => !e.endAt);
                return (
                  <div key={a.id} className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: a.staff.colour }}>
                        {a.staff.name.split(" ").map((x: string) => x[0]).slice(0, 2).join("")}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink-800">{a.staff.name}</p>
                        <p className="text-[11px] text-ink-400">{a.isLead ? "Lead · " : ""}{minsToLabel(Math.round(mins))} tracked</p>
                      </div>
                    </div>
                    {j.status !== "COMPLETED" && j.status !== "CANCELLED" && (
                      <button disabled={busy}
                        onClick={() => run(() => callAction(isOpen ? "staff.checkOut" : "staff.checkIn", { jobId: id, staffId: a.staffId }), isOpen ? "Checked out" : "Checked in")}
                        className={`${isOpen ? "btn-outline" : "btn-primary"} btn-sm mt-2 w-full`}>
                        {isOpen ? t("job.checkOut") : t("job.checkIn")}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {costing.data && (
            <div className="card card-pad">
              <div className="mb-3 flex items-center justify-between">
                <p className="section-title">{t("job.costing")}</p>
                {!isStaff && <button onClick={() => setEditCosting(true)} className="btn-ghost btn-sm">{t("common.edit")}</button>}
              </div>
              <dl className="space-y-1.5 text-sm">
                <CostRow k={t("job.revenue")} v={costing.data.revenueCents} />
                <CostRow k={t("job.labour")} v={-costing.data.labourCents} />
                {/* Labour is the one figure nobody can check by eye, so the
                    hours and rate behind it are spelled out underneath. */}
                {costing.data.labourBreakdown?.length > 0 && (
                  <div className="space-y-0.5 pl-3">
                    {costing.data.labourBreakdown.map((b: any) => (
                      <div key={b.staff} className="flex items-center justify-between text-[11px] text-ink-400">
                        <dt>
                          {b.staff} · {b.fixed ? "set amount"
                            : b.payType === "HOURLY" ? `${minsToLabel(b.minutes)}${b.estimated ? " (scheduled)" : " tracked"}`
                            : b.payType === "PER_JOB" ? "per job" : "% of revenue"}
                        </dt>
                        <dd><Money cents={-b.costCents} /></dd>
                      </div>
                    ))}
                  </div>
                )}
                <CostRow k={t("job.material")} v={-costing.data.materialCents} />
                <CostRow k={t("job.otherExpenses")} v={-costing.data.otherExpenseCents} />
                {costing.data.expenses?.length > 0 && (
                  <div className="space-y-0.5 pl-3">
                    {costing.data.expenses.map((e: any) => (
                      <div key={e.id} className="flex items-center justify-between gap-2 text-[11px] text-ink-400">
                        <dt className="truncate">{[e.category, e.vendor || e.note].filter(Boolean).join(" · ") || e.ref}{e.staff ? ` · paid by ${e.staff}` : ""}</dt>
                        <dd><Money cents={-e.amountCents} /></dd>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-ink-100 pt-2">
                  <dt className="text-sm font-medium">Profit</dt>
                  <dd className={`text-base font-semibold ${costing.data.profitCents >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    <Money cents={costing.data.profitCents} /></dd>
                </div>
                <p className="text-right text-xs text-ink-400">{costing.data.marginPct}% {t("dash.margin")}</p>
              </dl>
              {costing.data.labourEstimated && (
                <p className="mt-2 rounded-lg bg-ink-50 p-2 text-[11px] leading-relaxed text-ink-500">
                  No usable check-in time was logged, so labour is estimated from the scheduled
                  duration. Check cleaners in and out on the job to cost it on real hours.
                </p>
              )}
              {costing.data.staffWithoutRate?.length > 0 && (
                <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-800">
                  {costing.data.staffWithoutRate.join(", ")} {costing.data.staffWithoutRate.length > 1 ? "have" : "has"} no
                  pay rate set, so they add nothing to labour. Set it on
                  the <Link href="/staff" className="underline">staff record</Link>.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <AssignModal open={assign} onClose={() => setAssign(false)} job={j} onDone={reload} />
      <RescheduleJob open={resched} onClose={() => setResched(false)} job={j} onDone={reload} />
      <NotesModal value={notes} onClose={() => setNotes(null)} job={j} onDone={reload} />
      <PriceModal open={price} onClose={() => setPrice(false)} job={j} onDone={reload} />
      <MoveCustomerModal open={move} onClose={() => setMove(false)} job={j} onDone={reload} />
      {costing.data && <CostingModal open={editCosting} onClose={() => setEditCosting(false)} job={j} costing={costing.data} onDone={reload} />}
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: any }) => (
  <div><dt className="text-xs text-ink-400">{k}</dt><dd className="mt-0.5 text-sm text-ink-800">{v}</dd></div>
);
const CostRow = ({ k, v }: { k: string; v: number }) => (
  <div className="flex items-center justify-between"><dt className="text-xs text-ink-500">{k}</dt>
    <dd className={v < 0 ? "text-ink-500" : "text-ink-800"}><Money cents={v} /></dd></div>
);

function Photos({ job, onDone }: any) {
  const t = useT();
  const [kind, setKind] = useState<"BEFORE" | "AFTER" | "ATTACHMENT">("BEFORE");
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const isStaff = useIsStaff();
  // A URL that will not load stays broken forever, so the tile says so and
  // offers a way out rather than showing the browser's broken-image glyph.
  const [broken, setBroken] = useState<Record<string, boolean>>({});

  async function remove(p: any) {
    if (!confirm(`Remove this ${p.kind.toLowerCase()} photo from ${job.ref}?`)) return;
    try { await callAction("jobs.deletePhoto", { photoId: p.id }); toast("Photo removed"); onDone(); }
    catch (e: any) { toast(e.message, "err"); }
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      await callAction("jobs.addPhoto", { jobId: job.id, url: j.url, kind });
      toast("Photo added"); onDone();
    } catch (err: any) { toast(err.message, "err"); }
    finally { setBusy(false); if (input.current) input.current.value = ""; }
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
        <p className="section-title">{t("job.photos")}</p>
        <div className="flex items-center gap-1.5">
          <select className="input w-auto py-1 text-xs" value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="BEFORE">Before</option><option value="AFTER">After</option><option value="ATTACHMENT">Attachment</option>
          </select>
          <button onClick={() => input.current?.click()} disabled={busy} className="btn-outline btn-sm">{busy ? "…" : t("common.add")}</button>
          <input ref={input} type="file" accept="image/*" className="hidden" onChange={upload} />
        </div>
      </div>
      <div className="p-4">
        {!job.photos.length ? <p className="py-4 text-center text-xs text-ink-400">No photos yet</p> : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {job.photos.map((p: any) => {
              const isPdf = /\.pdf($|\?)/i.test(p.url);
              const dead = broken[p.id];
              return (
                <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg bg-ink-100">
                  <a href={p.url} target="_blank" rel="noreferrer" className="block h-full w-full">
                    {dead ? (
                      <span className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
                        <span className="text-lg">⚠️</span>
                        <span className="text-[10px] leading-tight text-ink-500">Image will not load</span>
                      </span>
                    ) : isPdf ? (
                      <span className="flex h-full w-full flex-col items-center justify-center gap-1 text-ink-500">
                        <span className="text-lg">📄</span><span className="text-[10px]">PDF</span>
                      </span>
                    ) : (
                      <img src={p.url} alt={p.caption || p.kind} loading="lazy"
                        onError={() => setBroken((b) => ({ ...b, [p.id]: true }))}
                        className="h-full w-full object-cover transition group-hover:scale-105" />
                    )}
                  </a>
                  <span className="absolute left-1 top-1 badge bg-ink-900/70 text-white">{p.kind}</span>
                  {!isStaff && (
                    <button onClick={() => remove(p)} title="Remove this photo"
                      className="absolute right-1 top-1 rounded-md bg-ink-900/70 p-1 text-white opacity-0 transition hover:bg-rose-600 focus:opacity-100 group-hover:opacity-100">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AssignModal({ open, onClose, job, onDone }: any) {
  const t = useT();
  const staff = useAction<any[]>("staff.list", {});
  const avail = useAction<any[]>("staff.findAvailable", { startAt: new Date(job.scheduledAt).toISOString(), durationMin: job.durationMin, excludeJobId: job.id });
  const [ids, setIds] = useState<string[]>(job.assignments.map((a: any) => a.staffId));
  useEffect(() => { if (open) { setIds(job.assignments.map((a: any) => a.staffId)); avail.refresh(); } }, [open, job.assignments]);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { await callAction("jobs.assignStaff", { jobId: job.id, staffIds: ids }); toast("Cleaners updated"); onDone(); onClose(); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={t("job.cleaners")}>
      <div className="space-y-2">
        {(staff.data ?? []).map((s) => {
          const a = avail.data?.find((x) => x.staffId === s.id);
          const on = ids.includes(s.id);
          return (
            <button key={s.id} disabled={!on && !a?.available} onClick={() => setIds(on ? ids.filter((x) => x !== s.id) : [...ids, s.id])}
              className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition ${on ? "border-brand-400 bg-brand-50" : "border-ink-200 hover:bg-ink-50"}`}>
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-white" style={{ background: s.colour }}>
                {s.name.split(" ").map((x: string) => x[0]).slice(0, 2).join("")}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink-800">{s.name}</span>
                <span className={`text-[11px] ${a?.available ? "text-emerald-600" : "text-amber-600"}`}>{a?.reason ?? "—"}</span>
              </span>
              {on && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="text-brand-600"><path d="m5 13 4 4L19 7"/></svg>}
            </button>
          );
        })}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={go} disabled={busy} className="btn-primary">{t("common.save")}</button>
        </div>
      </div>
    </Modal>
  );
}

function RescheduleJob({ open, onClose, job, onDone }: any) {
  const t = useT();
  const [when, setWhen] = useState(toInput(new Date(job.scheduledAt)));
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { await callAction("jobs.reschedule", { jobId: job.id, scheduledAt: new Date(when).toISOString() }); toast("Job rescheduled"); onDone(); onClose(); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={t("bk.reschedule")}>
      <div className="space-y-3">
        <Field label="New date & time"><input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={go} disabled={busy} className="btn-primary">{t("common.save")}</button></div>
      </div>
    </Modal>
  );
}

function NotesModal({ value, onClose, job, onDone }: any) {
  const t = useT();
  const [internal, setInternal] = useState(job.internalNotes ?? "");
  const [staffNotes, setStaffNotes] = useState(job.staffNotes ?? "");
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try { await callAction("jobs.update", { jobId: job.id, internalNotes: internal, staffNotes }); toast("Notes saved"); onDone(); onClose(); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }
  return (
    <Modal open={value !== null} onClose={onClose} title={t("common.notes")}>
      <div className="space-y-3">
        <Field label={t("job.internalNotes")}><textarea className="input" rows={3} value={internal} onChange={(e) => setInternal(e.target.value)} /></Field>
        <Field label={t("job.staffNotes")}><textarea className="input" rows={3} value={staffNotes} onChange={(e) => setStaffNotes(e.target.value)} /></Field>
        <div className="flex justify-end gap-2"><button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={go} disabled={busy} className="btn-primary">{t("common.save")}</button></div>
      </div>
    </Modal>
  );
}

/** Correcting the amount moves the booking line, the job and the invoice together. */
function PriceModal({ open, onClose, job, onDone }: any) {
  const t = useT();
  const [amount, setAmount] = useState((job.revenueCents / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setAmount((job.revenueCents / 100).toFixed(2)); }, [open, job.revenueCents]);
  async function go() {
    setBusy(true);
    try {
      const r = await callAction("jobs.setPrice", { jobId: job.id, amountCents: toCents(amount) });
      toast(r.invoice && r.invoice.outstandingCents > 0
        ? `Updated — ${fmt(r.invoice.outstandingCents)} now outstanding on ${r.invoice.ref}`
        : "Amount updated");
      onDone(); onClose();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Edit amount · ${job.ref}`}>
      <div className="space-y-3">
        <Field label="Amount charged (RM)" hint="Updates the booking, the job and the invoice together.">
          <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <p className="text-[11px] text-ink-400">
          Currently <Money cents={job.revenueCents} />. Money already received stays received — the invoice simply
          goes back to part-paid if the new amount is higher.
        </p>
        <div className="flex justify-end gap-2"><button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={go} disabled={busy} className="btn-primary">{busy ? t("common.saving") : t("common.save")}</button></div>
      </div>
    </Modal>
  );
}

type LabourRow = { staffId: string; name: string; basis: string; calculatedCents: number; amount: string; isNew: boolean; original: number | null };
type ExpenseRow = { key: string; id?: string; ref?: string; amount: string; category: string; vendor: string;
  staffId: string; reimbursable: boolean; reimbursed: boolean; date: string; original?: any };

const cents = (s: string) => (s.trim() === "" ? null : toCents(s));
const payBasis = (b: { payType: string; payRate: number }) => b.payRate === 0 ? "no pay rate set"
  : b.payType === "HOURLY" ? `${fmt(b.payRate)}/hr` : b.payType === "PER_JOB" ? `${fmt(b.payRate)}/job` : `${b.payRate / 100}% of job`;

/**
 * Everything that costs the job money, edited together: what each cleaner is
 * paid for it, the materials it used, and the expenses booked against it.
 * Labour set here is what payroll pays and the reports deduct; the expenses are
 * real expense records, so they also show under Expenses and reimbursements.
 */
function CostingModal({ open, onClose, job, costing, onDone }: any) {
  const t = useT();
  const staff = useAction<any[]>("staff.list", {});
  const cats = useAction<any[]>("expenses.categories", {});
  const [labour, setLabour] = useState<LabourRow[]>([]);
  const [materials, setMaterials] = useState("");
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const jobDate = isoDate(new Date(job.scheduledAt));

  useEffect(() => {
    if (!open) return;
    setLabour(costing.labourBreakdown.map((b: any) => ({
      staffId: b.staffId, name: b.staff, basis: payBasis(b), calculatedCents: b.calculatedCents,
      amount: b.fixed ? (b.costCents / 100).toFixed(2) : "", isNew: false, original: b.fixed ? b.costCents : null,
    })));
    setMaterials((costing.materialCents / 100).toFixed(2));
    setExpenses(costing.expenses.map((e: any) => ({
      key: e.id, id: e.id, ref: e.ref, amount: (e.amountCents / 100).toFixed(2), category: e.category ?? "",
      vendor: e.vendor ?? e.note ?? "", staffId: e.staffId ?? "", reimbursable: e.reimbursable, reimbursed: e.reimbursed,
      date: isoDate(new Date(e.spentAt)), original: e,
    })));
    setRemoved([]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const setL = (i: number, patch: Partial<LabourRow>) => setLabour((rows) => rows.map((r, n) => n === i ? { ...r, ...patch } : r));
  const setE = (i: number, patch: Partial<ExpenseRow>) => setExpenses((rows) => rows.map((r, n) => n === i ? { ...r, ...patch } : r));
  const available = (staff.data ?? []).filter((s) => !labour.some((l) => l.staffId === s.id));

  function addCleaner(id: string) {
    const s = (staff.data ?? []).find((x) => x.id === id);
    if (!s) return;
    // Mirrors labourFor() on the server: hourly on a finished job with nothing
    // tracked is estimated from the scheduled duration.
    const calc = s.payType === "PER_JOB" ? s.payRate : s.payType === "PERCENT" ? Math.round((job.revenueCents * s.payRate) / 10000)
      : job.status === "COMPLETED" ? Math.round((job.durationMin / 60) * s.payRate) : 0;
    setLabour((rows) => [...rows, { staffId: s.id, name: s.name, basis: payBasis(s), calculatedCents: calc, amount: "", isNew: true, original: null }]);
  }
  function removeExpense(i: number) {
    const row = expenses[i];
    if (row.id) setRemoved((r) => [...r, row.id!]);
    setExpenses((rows) => rows.filter((_, n) => n !== i));
  }

  // Live totals, so the effect of an edit on profit is visible before saving.
  const labourTotal = labour.reduce((a, l) => a + (cents(l.amount) ?? l.calculatedCents), 0);
  const materialTotal = cents(materials) ?? 0;
  const expenseTotal = expenses.reduce((a, e) => a + (cents(e.amount) ?? 0), 0);
  const profit = job.revenueCents - labourTotal - materialTotal - expenseTotal;

  async function save() {
    for (const l of labour) if (l.amount.trim() && !(toCents(l.amount) >= 0 && /\d/.test(l.amount))) return toast(`Check the labour amount for ${l.name}`, "err");
    if (materialTotal < 0) return toast("Materials cannot be negative", "err");
    for (const e of expenses) if (!((cents(e.amount) ?? 0) > 0)) return toast("Every expense needs an amount above zero", "err");

    const labourChanges = labour.filter((l) => l.isNew || cents(l.amount) !== l.original)
      .map((l) => ({ staffId: l.staffId, labourCents: cents(l.amount) }));
    const fields = (e: ExpenseRow) => ({
      amountCents: toCents(e.amount), categoryName: e.category.trim() || undefined, vendor: e.vendor.trim() || null,
      staffId: e.staffId || null, reimbursable: !!e.staffId && e.reimbursable, spentAt: new Date(e.date || jobDate).toISOString(),
    });
    const changed = (e: ExpenseRow) => {
      const o = e.original, f = fields(e);
      return f.amountCents !== o.amountCents || (f.categoryName ?? "") !== (o.category ?? "") || (f.vendor ?? "") !== (o.vendor ?? o.note ?? "")
        || (f.staffId ?? null) !== (o.staffId ?? null) || f.reimbursable !== o.reimbursable || e.date !== isoDate(new Date(o.spentAt));
    };
    const payload: any = { jobId: job.id };
    if (labourChanges.length) payload.labour = labourChanges;
    if (materialTotal !== costing.materialCents) payload.materialCostCents = materialTotal;
    const adds = expenses.filter((e) => !e.id).map(fields);
    const updates = expenses.filter((e) => e.id && changed(e)).map((e) => {
      const f: any = fields(e);
      // An unchanged vendor may really be the note; leave it alone rather than move it.
      if ((f.vendor ?? "") === (e.original.vendor ?? e.original.note ?? "")) delete f.vendor;
      return { expenseId: e.id, ...f };
    });
    if (adds.length) payload.addExpenses = adds;
    if (updates.length) payload.updateExpenses = updates;
    if (removed.length) payload.removeExpenseIds = removed;
    if (Object.keys(payload).length === 1) { onClose(); return; }

    setBusy(true);
    try { await callAction("jobs.updateCosting", payload); toast("Costing saved"); onDone(); onClose(); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={`${t("job.costing")} · ${job.ref}`} wide>
      <div className="space-y-5">
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="section-title">{t("job.labour")}</p>
            <span className="text-xs text-ink-500"><Money cents={labourTotal} /></span>
          </div>
          <p className="mb-2 text-[11px] text-ink-400">What you pay each cleaner for this job. Leave blank to use their pay rate. This is the amount Payroll pays.</p>
          <div className="space-y-2">
            {labour.map((l, i) => (
              <div key={l.staffId} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-800">{l.name}{l.isNew && <span className="ml-1.5 badge bg-brand-50 text-brand-600">new</span>}</p>
                  <p className="text-[11px] text-ink-400">{l.basis} · calculated <Money cents={l.calculatedCents} /></p>
                </div>
                <div className="relative w-32">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-400">RM</span>
                  <input className="input pl-9 text-right" inputMode="decimal" value={l.amount}
                    placeholder={(l.calculatedCents / 100).toFixed(2)} aria-label={`Labour for ${l.name}`}
                    onChange={(e) => setL(i, { amount: e.target.value })} />
                </div>
                {l.isNew ? (
                  <button onClick={() => setLabour((rows) => rows.filter((_, n) => n !== i))} title="Remove" className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-red-600">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
                  </button>
                ) : <span className="w-[26px]" />}
              </div>
            ))}
            {!labour.length && <p className="rounded-lg bg-ink-50 p-2.5 text-xs text-ink-500">No cleaner on this job yet. Add one below to record what they were paid.</p>}
            {available.length > 0 && (
              <select className="input w-auto text-xs" value="" onChange={(e) => addCleaner(e.target.value)}>
                <option value="">+ Add cleaner…</option>
                {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
            <p className="text-[11px] text-ink-400">Paid someone who is not on your staff list? Add it under Other expenses with the category Labour.</p>
          </div>
        </section>

        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="section-title">{t("job.material")}</p>
            <span className="text-xs text-ink-500"><Money cents={materialTotal} /></span>
          </div>
          <div className="flex items-center gap-2">
            <p className="flex-1 text-[11px] text-ink-400">Supplies and consumables from your own stock that this job used up.</p>
            <div className="relative w-32">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-400">RM</span>
              <input className="input pl-9 text-right" inputMode="decimal" value={materials} aria-label="Materials cost" onChange={(e) => setMaterials(e.target.value)} />
            </div>
            <span className="w-[26px]" />
          </div>
        </section>

        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <p className="section-title">{t("job.otherExpenses")}</p>
            <span className="text-xs text-ink-500"><Money cents={expenseTotal} /></span>
          </div>
          <p className="mb-2 text-[11px] text-ink-400">Money spent for this job — transport, parking, supplies bought for it. Saved as expenses, so they also appear under Expenses.</p>
          <datalist id="costing-categories">{(cats.data ?? []).map((c) => <option key={c.id} value={c.name} />)}</datalist>
          <div className="space-y-2">
            {expenses.map((e, i) => (
              <div key={e.key} className="rounded-lg border border-ink-100 p-2.5">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1.4fr_7.5rem]">
                  <input className="input text-xs" list="costing-categories" placeholder="Category" value={e.category} onChange={(x) => setE(i, { category: x.target.value })} aria-label="Category" />
                  <input className="input text-xs" placeholder="What / where (optional)" value={e.vendor} onChange={(x) => setE(i, { vendor: x.target.value })} aria-label="Description" />
                  <div className="relative col-span-2 sm:col-span-1">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-400">RM</span>
                    <input className="input pl-9 text-right text-xs" inputMode="decimal" placeholder="0.00" value={e.amount} onChange={(x) => setE(i, { amount: x.target.value })} aria-label="Amount" />
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input type="date" className="input w-auto py-1 text-xs" value={e.date} onChange={(x) => setE(i, { date: x.target.value })} aria-label="Date" />
                  <select className="input w-auto py-1 text-xs" value={e.staffId} aria-label="Paid by"
                    onChange={(x) => setE(i, { staffId: x.target.value, reimbursable: !!x.target.value })}>
                    <option value="">Paid by business</option>
                    {(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>Paid by {s.name}</option>)}
                  </select>
                  {e.staffId && (
                    <label className="flex items-center gap-1.5 text-[11px] text-ink-500">
                      <input type="checkbox" checked={e.reimbursable} onChange={(x) => setE(i, { reimbursable: x.target.checked })} /> Owed back
                    </label>
                  )}
                  {e.reimbursed && <span className="badge bg-emerald-50 text-emerald-600">Reimbursed</span>}
                  {e.ref && <span className="text-[10px] text-ink-300">{e.ref}</span>}
                  <button onClick={() => removeExpense(i)} className="ml-auto rounded-md px-2 py-1 text-[11px] text-ink-400 hover:bg-red-50 hover:text-red-600">Remove</button>
                </div>
              </div>
            ))}
            <button onClick={() => setExpenses((rows) => [...rows, { key: `new-${Date.now()}`, amount: "", category: "", vendor: "", staffId: "", reimbursable: false, reimbursed: false, date: jobDate }])}
              className="btn-outline btn-sm">+ Add expense</button>
          </div>
        </section>

        <div className="rounded-lg bg-ink-50 p-3 text-sm">
          <div className="flex justify-between text-xs text-ink-500"><span>{t("job.revenue")}</span><Money cents={job.revenueCents} /></div>
          <div className="flex justify-between text-xs text-ink-500"><span>Total costs</span><Money cents={-(labourTotal + materialTotal + expenseTotal)} /></div>
          <div className="mt-1 flex justify-between border-t border-ink-200 pt-1 font-semibold">
            <span>Profit</span><span className={profit >= 0 ? "text-emerald-600" : "text-red-600"}><Money cents={profit} /></span>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={save} disabled={busy} className="btn-primary">{busy ? t("common.saving") : t("common.save")}</button>
        </div>
      </div>
    </Modal>
  );
}

/** Filed under the wrong name: moves the booking, job, invoice and payments at once. */
function MoveCustomerModal({ open, onClose, job, onDone }: any) {
  const t = useT();
  const [q, setQ] = useState("");
  const { data } = useAction<any[]>("customers.search", { query: q || undefined, limit: 20 });
  const [busy, setBusy] = useState(false);
  async function go(customerId: string, name: string) {
    if (!confirm(`Move ${job.ref} from ${job.customer.name} to ${name}? The booking, invoice and any payments move too.`)) return;
    setBusy(true);
    try { const r = await callAction("jobs.reassignCustomer", { jobId: job.id, customerId });
      toast(`Moved to ${r.to}`); onDone(); onClose(); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={`Change customer · ${job.ref}`}>
      <div className="space-y-3">
        <p className="text-sm text-ink-600">Currently filed under <strong>{job.customer.name}</strong>.</p>
        <Field label="Move to"><input className="input" placeholder="Search name, phone or company" value={q} onChange={(e) => setQ(e.target.value)} autoFocus /></Field>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-ink-100 divide-y divide-ink-50">
          {(data ?? []).filter((c) => c.id !== job.customerId).map((c) => (
            <button key={c.id} disabled={busy} onClick={() => go(c.id, c.name)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-ink-50">
              <span className="font-medium text-ink-800">{c.name}</span>
              <span className="text-[11px] text-ink-400">{c.phone ?? c.addresses?.[0]?.line1 ?? ""}</span>
            </button>
          ))}
          {!data?.length && <p className="px-3 py-4 text-center text-xs text-ink-400">No match</p>}
        </div>
        <p className="text-[11px] text-ink-400">The amount does not change — only whose record it sits on.</p>
        <div className="flex justify-end"><button onClick={onClose} className="btn-outline">{t("common.cancel")}</button></div>
      </div>
    </Modal>
  );
}
