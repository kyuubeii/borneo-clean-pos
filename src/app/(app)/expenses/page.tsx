"use client";
import { useState, useRef, useEffect } from "react";
import { useT } from "@/components/I18nProvider";
import { useAction, Money, Empty, Modal, Field, callAction, toast, Stat } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { useIsStaff } from "@/components/UserProvider";
import { fmtDate, addDays, isoDate } from "@/lib/dates";
import { toCents } from "@/lib/money";


export default function Expenses() {
  const t = useT();
  const [days, setDays] = useState(30);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const from = isoDate(addDays(new Date(), -days));
  const isStaff = useIsStaff();
  const { data, loading, refresh } = useAction<any[]>("expenses.list", { from, limit: 200 });
  // reports.expenseBreakdown is owner/admin only, so cleaners never request it.
  const breakdown = useAction<any[]>(isStaff ? "expenses.categories" : "reports.expenseBreakdown",
    isStaff ? {} : { from, to: isoDate(new Date()) });
  // Net of reimbursements already paid back, not the gross of every advance.
  const advances = useAction<any[]>("staff.advances", {});

  // An expense on a cancelled job stays listed but is not a cost, as in the reports.
  const total = (data ?? []).filter((e) => !e.jobCancelled).reduce((a, e) => a + e.amountCents, 0);
  const pendingReimb = (data ?? []).filter((e) => e.reimbursable && !e.reimbursed);
  const owedTotal = (advances.data ?? []).reduce((a: number, x: any) => a + x.stillOwedCents, 0);

  async function reimburse(id: string) {
    // The two summaries above read from a different action, so they need refreshing too.
    try { await callAction("expenses.markReimbursed", { expenseId: id }); toast("Marked reimbursed"); refresh(); advances.refresh(); }
    catch (e: any) { toast(e.message, "err"); }
  }
  const reloadAll = () => { refresh(); advances.refresh(); breakdown.refresh(); };

  return (
    <div>
      <PageHeader title={t("nav.expenses")} subtitle={t("common.lastDays").replace("{n}", String(days))} actions={
        <>
          <select className="input w-auto text-xs" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[7, 30, 90, 365].map((d) => <option key={d} value={d}>{t("common.lastDays").replace("{n}", String(d))}</option>)}
          </select>
          <button onClick={() => setOpen(true)} className="btn-primary btn-sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
            {t("common.new")}</button>
        </>} />

      <div className={`mb-4 grid gap-3 ${isStaff ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-4"}`}>
        <Stat label={isStaff ? t("staff.myExpenses") : "Total spent"} value={<Money cents={total} />} tone="warn" sub={`${data?.length ?? 0} entries`} />
        <Stat label={t("staff.reimbDue")} value={<Money cents={owedTotal} />}
          sub={(advances.data ?? []).filter((x: any) => x.stillOwedCents > 0).map((x: any) => `${x.name} ${(x.stillOwedCents/100).toFixed(0)}`).join(" · ") || undefined} />
        {!isStaff && <>
          <Stat label="Categories used" value={breakdown.data?.length ?? 0} />
          <Stat label="Top category" value={<span className="text-base">{breakdown.data?.[0]?.category ?? "—"}</span>}
            sub={breakdown.data?.[0] ? <Money cents={breakdown.data[0].amountCents} /> : undefined} />
        </>}
      </div>

      <div className={`grid gap-4 ${isStaff ? "" : "lg:grid-cols-4"}`}>
        <div className={`card overflow-hidden ${isStaff ? "" : "lg:col-span-3"}`}>
          {loading ? <p className="p-4 text-sm text-ink-400">{t("common.loading")}</p>
          : !data?.length ? <Empty text={t("common.empty")} />
          : <div className="overflow-x-auto">
              <table className="w-full min-w-[680px]">
                <thead className="border-b border-ink-100 bg-ink-50/50">
                  <tr><th className="th">{t("common.date")}</th><th className="th">Category</th>
                    <th className="th">Vendor / note</th><th className="th">Job</th>
                    <th className="th text-right">{t("common.amount")}</th><th className="th"></th></tr>
                </thead>
                <tbody className="divide-y divide-ink-50">
                  {data.map((e) => (
                    <tr key={e.id}>
                      <td className="td whitespace-nowrap text-ink-500">{fmtDate(new Date(e.spentAt))}</td>
                      <td className="td"><span className="badge bg-ink-100 text-ink-600">{e.category}</span></td>
                      <td className="td">
                        <span className="text-ink-700">{e.vendor ?? "—"}</span>
                        {e.note && <span className="ml-1 text-[11px] text-ink-400">{e.note}</span>}
                        {e.receiptUrl && <a href={e.receiptUrl} target="_blank" rel="noreferrer" className="ml-1.5 text-[11px] text-brand-600 hover:underline">receipt</a>}
                      </td>
                      <td className="td text-ink-500">
                        {e.jobRef ?? "—"}
                        {e.jobCancelled && <span className="ml-1.5 badge bg-red-50 text-red-500" title="The job was cancelled, so this is not counted as a cost">cancelled · not counted</span>}
                      </td>
                      <td className={`td text-right font-medium ${e.jobCancelled ? "text-ink-300 line-through" : ""}`}><Money cents={e.amountCents} /></td>
                      <td className="td">
                        <div className="flex items-center justify-end gap-1.5">
                          {e.reimbursable && (e.reimbursed
                            ? <span className="badge bg-emerald-50 text-emerald-600">Reimbursed</span>
                            : isStaff
                              ? <span className="badge bg-amber-50 text-amber-700">{t("staff.awaitingReimb")}</span>
                              : <button onClick={() => reimburse(e.id)} className="btn-outline btn-sm">Reimburse {e.staff ? e.staff.split(" ")[0] : ""}</button>)}
                          {!isStaff && <button onClick={() => setEditing(e)} aria-label={`Edit ${e.ref}`} title="Edit"
                            className="btn-outline btn-sm px-2 text-ink-500">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                          </button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>}
        </div>

        {!isStaff && <div className="space-y-4">
        <div className="card">
          <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">{t("staff.owedTitle")}</p></div>
          <div className="divide-y divide-ink-50">
            {(advances.data ?? []).map((x: any) => (
              <div key={x.staffId} className="px-4 py-2.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-ink-800">{x.name}</span>
                  <Money cents={x.stillOwedCents} className={x.stillOwedCents > 0 ? "font-semibold text-amber-600" : "text-ink-300"} />
                </div>
                <p className="mt-0.5 text-[11px] text-ink-400">
                  advanced <Money cents={x.advancedCents} /> · settled on rows <Money cents={x.clearedCents} /> · {x.entries} entries
                </p>
                {x.earnedCents > 0 && <p className="mt-0.5 text-[11px] text-ink-400">
                  plus <Money cents={x.earnedCents} /> pay on completed jobs (driver fees){x.wagesPaidCents > 0 && <>, less <Money cents={x.wagesPaidCents} /> wages paid</>}
                </p>}
                {x.collectedCents > 0 && <p className="mt-0.5 text-[11px] text-ink-400">
                  less <Money cents={x.collectedCents} /> customer payments {x.name} collected and kept
                </p>}
                {x.unallocatedCents > 0 && <p className="mt-0.5 text-[11px] text-ink-400">
                  of <Money cents={x.repaidCents} /> paid back, <Money cents={x.unallocatedCents} /> is not yet matched to rows —
                  ticking those rows records which advance it covered and will not change what is owed
                </p>}
              </div>
            ))}
            {!advances.data?.length && <p className="px-4 py-5 text-center text-xs text-ink-400">{t("staff.owedNone")}</p>}
          </div>
        </div>
        <div className="card">
          <div className="border-b border-ink-100 px-4 py-3"><p className="section-title">By category</p></div>
          <div className="divide-y divide-ink-50">
            {(breakdown.data ?? []).map((c) => {
              const pct = total > 0 ? (c.amountCents / total) * 100 : 0;
              return (
                <div key={c.category} className="px-4 py-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="truncate font-medium text-ink-700">{c.category}</span>
                    <Money cents={c.amountCents} className="text-ink-600" />
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-100">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </div>}
      </div>

      <ExpenseForm open={open} onClose={() => setOpen(false)} onDone={reloadAll} />
      <ExpenseForm open={!!editing} expense={editing} onClose={() => setEditing(null)} onDone={reloadAll} />
    </div>
  );
}

/** Records a new expense, or edits an existing one when `expense` is passed. */
function ExpenseForm({ open, onClose, onDone, expense }: any) {
  const t = useT();
  const editing = !!expense;
  const cats = useAction<any[]>("expenses.categories", {});
  // An old expense can be linked to an old job, so the list has to reach back far enough
  // to still contain it rather than quietly dropping the link on save.
  const jobFrom = expense ? isoDate(addDays(new Date(expense.spentAt), -60)) : isoDate(addDays(new Date(), -14));
  const jobs = useAction<any[]>("jobs.list", { from: jobFrom, to: isoDate(addDays(new Date(), 7)), limit: 200 });
  const staff = useAction<any[]>("staff.list", {});
  const blank = { amount: "", categoryName: "Fuel", vendor: "", note: "", jobId: "", staffId: "", reimbursable: false, spentAt: isoDate(new Date()) };
  const [f, setF] = useState<any>(blank);
  const [receipt, setReceipt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });

  // Refill whenever a different row is opened, so the form never shows the last one's values.
  const loaded = useRef<string | null>(null);
  useEffect(() => {
    if (!open) { loaded.current = null; return; }
    const key = expense?.id ?? "new";
    if (loaded.current === key) return;
    loaded.current = key;
    setF(expense ? {
      amount: (expense.amountCents / 100).toFixed(2), categoryName: expense.category === "Uncategorised" ? "" : expense.category,
      vendor: expense.vendor ?? "", note: expense.note ?? "", jobId: expense.jobId ?? "",
      staffId: expense.staffId ?? "", reimbursable: expense.reimbursable, spentAt: isoDate(new Date(expense.spentAt)),
    } : blank);
    setReceipt(expense?.receiptUrl ?? null);
  }, [open, expense]);

  async function remove() {
    if (!confirm(`Delete ${expense.ref} for RM ${(expense.amountCents / 100).toFixed(2)}? This cannot be undone.`)) return;
    setBusy(true);
    try { await callAction("expenses.delete", { expenseId: expense.id }); toast("Expense deleted"); onDone(); onClose(); }
    catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const j = await r.json();
    if (j.ok) { setReceipt(j.url); toast("Receipt attached"); } else toast(j.error, "err");
  }

  async function go() {
    if (!f.amount) return toast("Enter an amount", "err");
    setBusy(true);
    try {
      if (editing) {
        // Blank fields are sent as empty strings, not omitted, so clearing a vendor or a
        // note in the form actually clears it on the record.
        await callAction("expenses.update", {
          expenseId: expense.id, amountCents: toCents(f.amount), categoryName: f.categoryName || undefined,
          vendor: f.vendor || null, note: f.note || null, jobId: f.jobId || null, staffId: f.staffId || null,
          spentAt: new Date(f.spentAt).toISOString(), reimbursable: f.reimbursable,
        });
        toast("Expense updated"); onDone(); onClose();
      } else {
        await callAction("expenses.record", {
          amountCents: toCents(f.amount), categoryName: f.categoryName || undefined,
          vendor: f.vendor || undefined, note: f.note || undefined,
          jobId: f.jobId || undefined, staffId: f.staffId || undefined,
          spentAt: new Date(f.spentAt).toISOString(), reimbursable: f.reimbursable,
          receiptUrl: receipt ?? undefined,
        });
        toast("Expense recorded"); onDone(); onClose();
        setF({ ...f, amount: "", vendor: "", note: "", jobId: "" }); setReceipt(null);
      }
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Edit ${expense.ref}` : "Record expense"}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("common.amount")} (RM)`}><input className="input" inputMode="decimal" value={f.amount} onChange={set("amount")} placeholder="120.00" /></Field>
          <Field label={t("common.date")}><input type="date" className="input" value={f.spentAt} onChange={set("spentAt")} /></Field>
        </div>
        <Field label="Category">
          <input className="input" list="cats" value={f.categoryName} onChange={set("categoryName")} />
          <datalist id="cats">{(cats.data ?? []).map((c) => <option key={c.id} value={c.name} />)}</datalist>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Vendor (${t("common.optional")})`}><input className="input" value={f.vendor} onChange={set("vendor")} /></Field>
          <Field label={`Note (${t("common.optional")})`}><input className="input" value={f.note} onChange={set("note")} /></Field>
        </div>
        <Field label={`Link to job (${t("common.optional")})`} hint="Linked expenses appear in that job's costing.">
          <select className="input" value={f.jobId} onChange={set("jobId")}>
            <option value="">— none —</option>
            {(jobs.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.ref} · {j.customer}</option>)}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Paid by (${t("common.optional")})`}>
            <select className="input" value={f.staffId} onChange={set("staffId")}>
              <option value="">Business</option>
              {(staff.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Receipt">
            <button onClick={() => fileRef.current?.click()} className="btn-outline w-full">{receipt ? "✓ Attached" : "Upload"}</button>
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={upload} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-600">
          <input type="checkbox" checked={f.reimbursable} onChange={set("reimbursable")} /> Reimbursable to staff
        </label>
        {editing && expense.reimbursed && <p className="rounded-lg bg-amber-50 p-2.5 text-[11px] text-amber-900">
          This row is marked reimbursed. Changing who paid it clears that tick, because it recorded a repayment to {expense.staff}.</p>}
        <div className="flex items-center justify-between gap-2">
          {editing
            ? <button onClick={remove} disabled={busy} className="btn-outline btn-sm text-red-600">Delete</button>
            : <span />}
          <div className="flex gap-2"><button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
            <button onClick={go} disabled={busy} className="btn-primary">{busy ? t("common.saving") : editing ? t("common.save") : "Record"}</button></div>
        </div>
      </div>
    </Modal>
  );
}
