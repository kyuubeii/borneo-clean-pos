"use client";
import { use, useState, useEffect } from "react";
import Link from "next/link";
import { useT } from "@/components/I18nProvider";
import { useAction, Badge, Money, Empty, Modal, Field, callAction, toast } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import { fmtDateTime, toInput, minsToLabel } from "@/lib/dates";

export default function BookingDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useT();
  const { data: b, loading, refresh } = useAction<any>("bookings.get", { bookingId: id });
  const [resched, setResched] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [edit, setEdit] = useState(false);

  if (loading) return <p className="text-sm text-ink-400">{t("common.loading")}</p>;
  if (!b) return <Empty text="Booking not found" />;

  const total = b.totalCents ?? b.items.reduce((a: number, i: any) => a + i.qty * i.priceCents, 0);
  const recurring = (b.recurrence && b.recurrence !== "NONE") || b.parentId;

  return (
    <div className="space-y-4">
      <PageHeader title={b.ref} subtitle={b.customer.name}
        actions={<>
          {/* A past visit is exactly the one you need to correct, so editing is never
              hidden by the date — only a cancelled booking drops the cancel button. */}
          <button onClick={() => setEdit(true)} className="btn-outline btn-sm">{t("common.edit")}</button>
          <button onClick={() => setResched(true)} className="btn-outline btn-sm">{t("bk.reschedule")}</button>
          {b.status !== "CANCELLED" && <button onClick={() => setCancel(true)} className="btn-outline btn-sm text-red-600">{t("bk.cancelBooking")}</button>}
          <Link href="/bookings" className="btn-outline btn-sm">{t("common.back")}</Link>
        </>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card card-pad lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <Badge status={b.status} label={t(`bk.status.${b.status}`)} />
            {recurring && <span className="badge bg-purple-50 text-purple-600">↻ {t("bk.recurring")}</span>}
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Row k={`${t("common.date")} & ${t("common.time").toLowerCase()}`} v={fmtDateTime(new Date(b.startAt))} />
            <Row k={t("common.duration")} v={minsToLabel(b.durationMin)} />
            <Row k={t("common.customer")} v={<Link href={`/customers/${b.customerId}`} className="text-brand-600 hover:underline">{b.customer.name}</Link>} />
            <Row k={t("common.address")} v={b.address ? [b.address.line1, b.address.city].filter(Boolean).join(", ") : "—"} />
          </dl>
          {b.notes && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            <p className="mb-0.5 font-semibold">{t("job.instructions")}</p>{b.notes}</div>}
          {b.cancelReason && <div className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">{b.cancelReason}</div>}
        </div>

        <div className="card card-pad">
          <p className="section-title mb-3">Services</p>
          <div className="space-y-1.5">
            {b.items.map((i: any) => (
              <div key={i.id} className="flex items-center justify-between text-sm">
                <span className="text-ink-600">{i.name}{i.qty > 1 && ` ×${i.qty}`}</span>
                <Money cents={i.qty * i.priceCents} className="text-ink-700" />
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-ink-100 pt-2.5">
            <span className="text-sm font-medium">{t("common.total")}</span>
            <span className="text-base font-semibold"><Money cents={total} /></span>
          </div>
          {b.job && <Link href={`/jobs/${b.job.id}`} className="btn-outline btn-sm mt-3 w-full">View job {b.job.ref}</Link>}
        </div>
      </div>

      <EditModal open={edit} onClose={() => setEdit(false)} booking={b} onDone={refresh} />
      <RescheduleModal open={resched} onClose={() => setResched(false)} booking={b} onDone={refresh} />
      <CancelModal open={cancel} onClose={() => setCancel(false)} booking={b} recurring={!!recurring} onDone={refresh} />
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: any }) => (
  <div><dt className="text-xs text-ink-400">{k}</dt><dd className="mt-0.5 text-sm text-ink-800">{v}</dd></div>
);

function RescheduleModal({ open, onClose, booking, onDone }: any) {
  const t = useT();
  const [when, setWhen] = useState(toInput(new Date(booking.startAt)));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setWhen(toInput(new Date(booking.startAt))); setReason(""); } }, [open, booking.startAt]);
  async function go() {
    setBusy(true);
    try {
      await callAction("bookings.reschedule", { bookingId: booking.id, startAt: new Date(when).toISOString(), reason: reason || undefined });
      toast("Booking rescheduled"); onDone(); onClose();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={t("bk.reschedule")}>
      <div className="space-y-3">
        <Field label="New date & time"><input type="datetime-local" className="input" value={when} onChange={(e) => setWhen(e.target.value)} /></Field>
        <Field label={`Reason (${t("common.optional")})`}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <p className="text-[11px] text-ink-400">Only this visit moves. A recurring series keeps its other dates.</p>
        <div className="flex justify-end gap-2"><button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={go} disabled={busy} className="btn-primary">{t("bk.reschedule")}</button></div>
      </div>
    </Modal>
  );
}

function CancelModal({ open, onClose, booking, recurring, onDone }: any) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [whole, setWhole] = useState(false);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      await callAction("bookings.cancel", { bookingId: booking.id, reason: reason || undefined, wholeSeries: whole });
      toast("Booking cancelled"); onDone(); onClose();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title={t("bk.cancelBooking")}>
      <div className="space-y-3">
        <p className="text-sm text-ink-600">Cancel booking <strong>{booking.ref}</strong> for {booking.customer.name}?</p>
        <Field label={`Reason (${t("common.optional")})`}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        {recurring && (
          <label className="flex items-center gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
            <input type="checkbox" checked={whole} onChange={(e) => setWhole(e.target.checked)} />
            Also cancel all remaining future visits in this series
          </label>
        )}
        <div className="flex justify-end gap-2"><button onClick={onClose} className="btn-outline">{t("common.back")}</button>
          <button onClick={go} disabled={busy} className="btn-danger">{t("bk.cancelBooking")}</button></div>
      </div>
    </Modal>
  );
}

/** Everything about a booking except its date, which goes through Reschedule so the
 *  move is announced, and its amount, which is corrected on the job so the invoice
 *  stays in step. */
function EditModal({ open, onClose, booking, onDone }: any) {
  const t = useT();
  const cust = useAction<any>("customers.get", { customerId: booking.customerId });
  const [f, setF] = useState({
    durationMin: String(booking.durationMin), addressId: booking.addressId ?? "",
    notes: booking.notes ?? "", internalNotes: booking.internalNotes ?? "", status: booking.status,
  });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setF({ durationMin: String(booking.durationMin), addressId: booking.addressId ?? "",
      notes: booking.notes ?? "", internalNotes: booking.internalNotes ?? "", status: booking.status });
  }, [open, booking]);

  async function go() {
    setBusy(true);
    try {
      await callAction("bookings.update", {
        bookingId: booking.id, durationMin: Number(f.durationMin) || booking.durationMin,
        status: f.status, addressId: f.addressId || undefined, notes: f.notes, internalNotes: f.internalNotes,
      });
      toast("Booking updated"); onDone(); onClose();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={`${t("common.edit")} ${booking.ref}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={`${t("common.duration")} (minutes)`}>
            <input className="input" inputMode="numeric" value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} />
          </Field>
          <Field label={t("common.status")}>
            <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              {["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"].map((x) => <option key={x} value={x}>{t(`bk.status.${x}`)}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t("common.address")}>
          <select className="input" value={f.addressId} onChange={(e) => setF({ ...f, addressId: e.target.value })}>
            <option value="">— none —</option>
            {(cust.data?.addresses ?? []).map((a: any) => <option key={a.id} value={a.id}>{[a.label, a.line1].filter(Boolean).join(" · ")}</option>)}
          </select>
        </Field>
        <Field label={t("job.instructions")}><textarea className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Field label="Internal notes"><textarea className="input" rows={2} value={f.internalNotes} onChange={(e) => setF({ ...f, internalNotes: e.target.value })} /></Field>
        <p className="text-[11px] text-ink-400">
          Date and time are changed with Reschedule.
          {booking.job && <> The amount is corrected on <Link href={`/jobs/${booking.job.id}`} className="text-brand-600 hover:underline">job {booking.job.ref}</Link>, so the invoice moves with it.</>}
        </p>
        <div className="flex justify-end gap-2"><button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={go} disabled={busy} className="btn-primary">{busy ? t("common.saving") : t("common.save")}</button></div>
      </div>
    </Modal>
  );
}
