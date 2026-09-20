"use client";
import { useEffect, useState } from "react";
import { useT } from "@/components/I18nProvider";
import { Modal, Field, callAction, toast, humanError } from "@/components/ui";

/**
 * The customer profile and address forms, shared by the Customers list and a
 * customer's own page.
 *
 * They live here rather than beside one screen because both screens offer the
 * same edit, and a form copied into two files drifts: the list's copy already
 * told people addresses were managed on the customer's page before that page
 * could manage them.
 *
 * On an edit, a box left empty is sent as "" rather than dropped, which the
 * registry reads as "clear this". Dropping it is what made clearing a field
 * report success and change nothing.
 */

const BLANK_CUSTOMER = { name: "", phone: "", email: "", company: "", line1: "", city: "Kuching", notes: "" };

/** Create when `initial` is absent, edit when it is there. */
export function CustomerForm({ open, onClose, onDone, initial }: {
  open: boolean; onClose: () => void; onDone: (c?: any) => void; initial?: any;
}) {
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
        // Blanks go as "" on purpose — see the note at the top of this file.
        // Addresses are their own records with their own actions, so this form
        // edits the customer and the address fields stay off an existing one.
        const c = await callAction("customers.update", {
          customerId: initial.id, name: f.name.trim(), phone: f.phone, email: f.email,
          company: f.company, notes: f.notes,
        });
        toast("Customer updated");
        onDone(c);
      } else {
        const c = await callAction("customers.create", {
          name: f.name.trim(), phone: f.phone || undefined, email: f.email || undefined,
          company: f.company || undefined, notes: f.notes || undefined,
          address: f.line1 ? { label: "Home", line1: f.line1, city: f.city } : undefined,
        });
        toast("Customer created");
        onDone(c);
      }
      onClose();
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
        <Field label={t("common.notes")}><textarea className="input" rows={2} value={f.notes} onChange={set("notes")} /></Field>
        {initial && <p className="text-[11px] text-ink-400">
          Emptying a box clears it. Service addresses are managed further down this customer&rsquo;s page.
        </p>}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? t("common.saving") : initial ? t("common.save") : t("common.create")}</button>
        </div>
      </div>
    </Modal>
  );
}

const BLANK_ADDRESS = { label: "Site", line1: "", line2: "", city: "Kuching", state: "Sarawak", postcode: "", accessNotes: "", isPrimary: false };

/**
 * Add an address when `initial` is absent, edit one when it is there.
 *
 * `isPrimary` is one-way on purpose: ticking it moves the flag off whichever
 * address had it, but there is no untick, because a customer with addresses and
 * no primary one is not a state any screen knows how to show. Move it by
 * ticking the address that should have it instead.
 */
export function AddressForm({ open, onClose, onDone, customerId, initial }: {
  open: boolean; onClose: () => void; onDone: () => void; customerId: string; initial?: any;
}) {
  const t = useT();
  const [f, setF] = useState<any>(BLANK_ADDRESS);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (!open) return;
    setF(initial
      ? { label: initial.label ?? "Site", line1: initial.line1 ?? "", line2: initial.line2 ?? "",
          city: initial.city ?? "", state: initial.state ?? "", postcode: initial.postcode ?? "",
          accessNotes: initial.accessNotes ?? "", isPrimary: !!initial.isPrimary }
      : BLANK_ADDRESS);
  }, [open, initial]);

  async function save() {
    if (!f.line1.trim()) return toast("The street address is required", "err");
    if (!f.label.trim()) return toast("Give the address a label, e.g. Home or Office", "err");
    setBusy(true);
    try {
      if (initial) {
        await callAction("customers.updateAddress", {
          addressId: initial.id, label: f.label.trim(), line1: f.line1.trim(), line2: f.line2,
          city: f.city, state: f.state, postcode: f.postcode, accessNotes: f.accessNotes,
          // Already-primary means "leave it alone"; sending false would not
          // unset it anyway, and the action treats undefined as no change.
          ...(f.isPrimary && !initial.isPrimary ? { isPrimary: true } : {}),
        });
        toast("Address updated");
      } else {
        await callAction("customers.addAddress", {
          customerId, label: f.label.trim(), line1: f.line1.trim(),
          line2: f.line2 || undefined, city: f.city || undefined, state: f.state || undefined,
          postcode: f.postcode || undefined, accessNotes: f.accessNotes || undefined,
          isPrimary: !!f.isPrimary,
        });
        toast("Address added");
      }
      onDone(); onClose();
    } catch (e: any) { toast(humanError(e.message), "err"); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title={initial ? `Edit ${initial.label}` : "Add a service address"}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Label" hint="Home, Office, Shop lot…">
            <input className="input" value={f.label} onChange={set("label")} />
          </Field>
          <div className="col-span-2">
            <Field label={t("common.address")}><input className="input" value={f.line1} onChange={set("line1")} /></Field>
          </div>
        </div>
        <Field label={`Address line 2 (${t("common.optional")})`}>
          <input className="input" value={f.line2} onChange={set("line2")} />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="City"><input className="input" value={f.city} onChange={set("city")} /></Field>
          <Field label="State"><input className="input" value={f.state} onChange={set("state")} /></Field>
          <Field label="Postcode"><input className="input" value={f.postcode} onChange={set("postcode")} /></Field>
        </div>
        <Field label="Access notes" hint="Gate code, where the key is, which dog bites.">
          <textarea className="input" rows={2} value={f.accessNotes} onChange={set("accessNotes")} />
        </Field>
        {initial?.isPrimary ? (
          <p className="text-[11px] text-ink-400">
            This is the primary address. To move that, tick the box on the one that should have it.
          </p>
        ) : (
          <label className="flex items-center gap-2 text-sm text-ink-600">
            <input type="checkbox" className="h-4 w-4 rounded border-ink-300" checked={f.isPrimary}
              onChange={(e) => setF({ ...f, isPrimary: e.target.checked })} />
            Make this the primary address
          </label>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? t("common.saving") : initial ? t("common.save") : t("common.add")}</button>
        </div>
      </div>
    </Modal>
  );
}
