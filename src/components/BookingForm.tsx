"use client";
import { useState, useEffect } from "react";
import { useT } from "./I18nProvider";
import { Modal, Field, callAction, toast, Money } from "./ui";
import { toInput, minsToLabel } from "@/lib/dates";

/** Shared create-booking flow: customer → services → when → cleaners. */
export default function BookingForm({ open, onClose, onDone, presetCustomerId, presetStart }: {
  open: boolean; onClose: () => void; onDone?: () => void; presetCustomerId?: string; presetStart?: Date;
}) {
  const t = useT();
  const [customers, setCustomers] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [staff, setStaff] = useState<any[]>([]);
  const [avail, setAvail] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  const [customerId, setCustomerId] = useState(presetCustomerId ?? "");
  const [addressId, setAddressId] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [startAt, setStartAt] = useState(toInput(presetStart ?? nextHour()));
  const [recurrence, setRecurrence] = useState("NONE");
  const [recurUntil, setRecurUntil] = useState("");
  const [staffIds, setStaffIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    callAction("customers.search", { limit: 50 }).then(setCustomers).catch(() => {});
    callAction("services.list", {}).then(setServices).catch(() => {});
    callAction("staff.list", {}).then(setStaff).catch(() => {});
  }, [open]);

  useEffect(() => { if (presetCustomerId) setCustomerId(presetCustomerId); }, [presetCustomerId]);

  const cust = customers.find((c) => c.id === customerId);
  const chosen = services.filter((s) => picked.includes(s.id));
  const duration = chosen.reduce((a, s) => a + s.durationMin, 0);
  const total = chosen.reduce((a, s) => a + s.priceCents, 0);

  // Refresh who is free whenever the slot changes.
  useEffect(() => {
    if (!open || !startAt || !duration) { setAvail(null); return; }
    callAction("staff.findAvailable", { startAt: new Date(startAt).toISOString(), durationMin: duration })
      .then(setAvail).catch(() => setAvail(null));
  }, [open, startAt, duration]);

  async function submit() {
    if (!customerId) return toast("Choose a customer", "err");
    if (!picked.length) return toast("Choose at least one service", "err");
    setBusy(true);
    try {
      const r = await callAction("bookings.create", {
        customerId, addressId: addressId || undefined,
        startAt: new Date(startAt).toISOString(), serviceIds: picked,
        notes: notes || undefined, recurrence,
        recurUntil: recurrence !== "NONE" && recurUntil ? new Date(recurUntil).toISOString() : undefined,
        staffIds: staffIds.length ? staffIds : undefined,
      });
      toast(`Booking ${r.booking.ref} created${r.recurringCreated ? ` + ${r.recurringCreated} repeats` : ""}`);
      onDone?.(); onClose(); reset();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  function reset() {
    setCustomerId(presetCustomerId ?? ""); setPicked([]); setStaffIds([]); setNotes("");
    setRecurrence("NONE"); setRecurUntil(""); setAddressId("");
  }

  return (
    <Modal open={open} onClose={onClose} title="New booking" wide>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.customer")}>
            <select className="input" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setAddressId(""); }}>
              <option value="">— select —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ""}</option>)}
            </select>
          </Field>
          <Field label={t("common.address")}>
            <select className="input" value={addressId} onChange={(e) => setAddressId(e.target.value)} disabled={!cust}>
              <option value="">Primary address</option>
              {cust?.addresses.map((a: any) => <option key={a.id} value={a.id}>{a.label} — {a.line1}</option>)}
            </select>
          </Field>
        </div>

        <div>
          <p className="label">Services</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {services.map((s) => {
              const on = picked.includes(s.id);
              return (
                <button key={s.id} type="button"
                  onClick={() => setPicked(on ? picked.filter((x) => x !== s.id) : [...picked, s.id])}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${
                    on ? "border-brand-400 bg-brand-50" : "border-ink-200 hover:bg-ink-50"}`}>
                  <span className="min-w-0">
                    <span className={`block truncate font-medium ${on ? "text-brand-700" : "text-ink-700"}`}>{s.name}</span>
                    <span className="text-ink-400">{minsToLabel(s.durationMin)}{s.isAddon ? " · add-on" : ""}</span>
                  </span>
                  <Money cents={s.priceCents} className={`ml-2 shrink-0 font-medium ${on ? "text-brand-700" : "text-ink-500"}`} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={`${t("common.date")} & ${t("common.time").toLowerCase()}`}>
            <input type="datetime-local" className="input" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </Field>
          <Field label="Repeat">
            <select className="input" value={recurrence} onChange={(e) => setRecurrence(e.target.value)}>
              <option value="NONE">{t("bk.oneTime")}</option>
              <option value="WEEKLY">{t("bk.weekly")}</option>
              <option value="FORTNIGHTLY">{t("bk.fortnightly")}</option>
              <option value="MONTHLY">{t("bk.monthly")}</option>
            </select>
          </Field>
          <Field label="Repeat until">
            <input type="date" className="input" value={recurUntil} disabled={recurrence === "NONE"}
              onChange={(e) => setRecurUntil(e.target.value)} />
          </Field>
        </div>

        {duration > 0 && (
          <div>
            <p className="label">Assign cleaners <span className="font-normal text-ink-300">· availability for this slot</span></p>
            <div className="flex flex-wrap gap-1.5">
              {staff.map((s) => {
                const a = avail?.find((x) => x.staffId === s.id);
                const on = staffIds.includes(s.id);
                return (
                  <button key={s.id} type="button"
                    onClick={() => setStaffIds(on ? staffIds.filter((x) => x !== s.id) : [...staffIds, s.id])}
                    title={a?.reason}
                    className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition ${
                      on ? "border-brand-400 bg-brand-50 text-brand-700"
                        : a && !a.available ? "border-ink-200 bg-ink-50 text-ink-300"
                        : "border-ink-200 hover:bg-ink-50"}`}>
                    <span className="h-2 w-2 rounded-full" style={{ background: a ? (a.available ? "#10b981" : "#d1d5db") : s.colour }} />
                    {s.name.split(" ")[0]}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Field label={`${t("job.instructions")} (${t("common.optional")})`}>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)}
            placeholder="Key with guardhouse, focus on kitchen…" />
        </Field>

        <div className="flex items-center justify-between rounded-lg bg-ink-50 px-3.5 py-2.5">
          <span className="text-xs text-ink-500">{chosen.length} service{chosen.length === 1 ? "" : "s"} · {minsToLabel(duration)}</span>
          <span className="text-base font-semibold text-ink-900"><Money cents={total} /></span>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={submit} disabled={busy} className="btn-primary">{busy ? t("common.saving") : "Create booking"}</button>
        </div>
      </div>
    </Modal>
  );
}

function nextHour() { const d = new Date(); d.setHours(d.getHours() + 1, 0, 0, 0); return d; }
