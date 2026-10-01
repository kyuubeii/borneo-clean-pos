"use client";
import { useState, useEffect, useRef } from "react";
import { useT } from "@/components/I18nProvider";
import { useAction, Field, callAction, toast, LoadError } from "@/components/ui";
import PageHeader from "@/components/PageHeader";

const MODELS = [
  "anthropic/claude-sonnet-4.5", "anthropic/claude-opus-4.1", "anthropic/claude-haiku-4.5",
  "openai/gpt-4.1", "google/gemini-2.5-pro", "meta-llama/llama-3.3-70b-instruct",
];

/**
 * What a setting shows before anyone has set it. Kept here rather than inline in
 * each input so that the value on screen is the value that gets saved: a default
 * shown only by the input was never in the form state, so pressing Save wrote
 * nothing and the field read as empty the next time the page was opened.
 */
const DEFAULTS: Record<string, string> = { "invoice.taxRateBp": "0", "invoice.dueDays": "14", "reminders.days": "1" };

export default function Settings() {
  const t = useT();
  const { data, loading, error, refresh } = useAction<Record<string, string>>("settings.get", {});
  const [f, setF] = useState<Record<string, string>>(DEFAULTS);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  /**
   * Fields edited since the last save.
   *
   * Two things depend on it. A save writes every edited field on the page, not
   * just the ones in one card -- this page used to carry a Save button per card
   * and each one silently discarded whatever had been typed into the others, so
   * filling the page in and pressing Save once lost most of it. And a re-read
   * from the server must not overwrite something half-typed.
   */
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!data) return;
    setF((prev) => {
      const next = { ...DEFAULTS, ...data };
      for (const k of dirtyRef.current) next[k] = prev[k];
      return next;
    });
  }, [data]);

  const set = (k: string) => (e: any) => {
    const v = e.target.type === "checkbox" ? String(e.target.checked) : e.target.value;
    setF((prev) => ({ ...prev, [k]: v }));
    setDirty((prev) => new Set(prev).add(k));
  };

  const setValue = (k: string, v: string) => {
    setF((prev) => ({ ...prev, [k]: v }));
    setDirty((prev) => new Set(prev).add(k));
  };

  const pending = dirty.size + (apiKey.trim() ? 1 : 0);

  async function save() {
    if (pending === 0) return;
    setBusy(true);
    try {
      const values: Record<string, string> = {};
      for (const k of dirty) values[k] = f[k] ?? "";
      if (apiKey.trim()) values["ai.apiKey"] = apiKey.trim();
      await callAction("settings.update", { values });
      // Cleared before the re-read so the fresh server values are not treated as
      // unsaved edits and held back.
      setDirty(new Set());
      setApiKey("");
      toast("Settings saved");
      refresh();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  async function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires onChange
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!j.ok) return toast(j.error ?? "Upload failed", "err");
      setValue("business.logoUrl", j.url);
      toast("Logo uploaded — press Save to keep it");
    } catch { toast("Upload failed", "err"); } finally { setBusy(false); }
  }

  if (loading) return <p className="text-sm text-ink-400">{t("common.loading")}</p>;

  return (
    <div className="max-w-3xl space-y-4 pb-24">
      <PageHeader title={t("nav.settings")} />
      <LoadError error={error} onRetry={refresh} />

      <Card title="Business profile">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business name"><input className="input" value={f["business.name"] ?? ""} onChange={set("business.name")} /></Field>
          <Field label="Tagline" hint="Printed under the business name on invoices and quotations.">
            <input className="input" value={f["business.tagline"] ?? ""} onChange={set("business.tagline")} placeholder="Cleaning Services" /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.email")}><input className="input" value={f["business.email"] ?? ""} onChange={set("business.email")} /></Field>
          <Field label={t("common.phone")}><input className="input" value={f["business.phone"] ?? ""} onChange={set("business.phone")} /></Field>
        </div>
        <Field label={t("common.address")}><textarea className="input" rows={2} value={f["business.address"] ?? ""} onChange={set("business.address")} /></Field>
        <Field label="Registration number"><input className="input" value={f["business.regNo"] ?? ""} onChange={set("business.regNo")} /></Field>
        <LogoField value={f["business.logoUrl"] ?? ""} onChange={set("business.logoUrl")}
          onClear={() => setValue("business.logoUrl", "")} onUpload={uploadLogo} busy={busy} />
      </Card>

      {/*
        * What a customer needs in order to pay, printed in the panel at the foot
        * of every invoice. It is not used anywhere else, and an unset field
        * prints as a dash rather than disappearing, so a half-filled panel is
        * visible rather than quietly wrong.
        */}
      <Card title="Payment details on invoices">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Bank"><input className="input" value={f["business.bank"] ?? ""} onChange={set("business.bank")} placeholder="AmBank" /></Field>
          <Field label="Account name"><input className="input" value={f["business.accountName"] ?? ""} onChange={set("business.accountName")} /></Field>
          <Field label="Account number"><input className="input" value={f["business.accountNumber"] ?? ""} onChange={set("business.accountNumber")} /></Field>
        </div>
        <Field label="Invoice payment terms" hint="Printed in the terms row and the payment panel.">
          <input className="input" value={f["invoice.paymentTerms"] ?? ""} onChange={set("invoice.paymentTerms")} placeholder="Due immediately upon receipt" /></Field>
        <Field label="Quotation payment terms">
          <input className="input" value={f["quote.paymentTerms"] ?? ""} onChange={set("quote.paymentTerms")} placeholder="To be agreed upon acceptance" /></Field>
      </Card>

      <Card title="Invoice defaults">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tax rate (basis points)" hint="600 = 6% SST">
            <input className="input" value={f["invoice.taxRateBp"] ?? ""} onChange={set("invoice.taxRateBp")} /></Field>
          <Field label="Payment terms (days)"><input className="input" value={f["invoice.dueDays"] ?? ""} onChange={set("invoice.dueDays")} /></Field>
        </div>
        <Field label="Invoice footer"><textarea className="input" rows={2} value={f["invoice.footer"] ?? ""} onChange={set("invoice.footer")} /></Field>
      </Card>

      <Card title="Notifications">
        <p className="text-xs text-ink-400">Notifications are delivered in-app. Email and SMS delivery are not configured in this version.</p>
        {[["notify.bookingConfirmation","Booking confirmations"],["notify.paymentReminders","Payment reminders"]].map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm text-ink-600">
            <input type="checkbox" checked={f[k] === "true"} onChange={set(k)} /> {label}
          </label>
        ))}
        <ReminderDays value={f["reminders.days"] ?? ""} onChange={(v) => setValue("reminders.days", v)} />
      </Card>

      <Card title="AI Assistant">
        <div className={`rounded-lg px-3 py-2 text-xs ${data?.["ai.hasKey"] === "true" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
          {data?.["ai.hasKey"] === "true" ? "✓ An OpenRouter API key is configured." : t("ai.noKey")}
        </div>
        <Field label="Model" hint="Any OpenRouter model that supports tool calling. Changing this does not affect the assistant's capabilities.">
          <input className="input" list="models" value={f["ai.model"] ?? ""} onChange={set("ai.model")} />
          <datalist id="models">{MODELS.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        <Field label="OpenRouter API key" hint="Stored server-side and never sent back to the browser. Leave blank to keep the current key.">
          <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-or-v1-…" />
        </Field>
      </Card>

      {/* One Save for the whole page: every card is the same record, and a button
          per card made it look as though each section saved on its own. */}
      <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-3 border-t border-ink-100 bg-white/95 px-1 py-3 backdrop-blur no-print">
        <span className="text-xs text-ink-400">
          {pending === 0 ? "All changes saved" : `${pending} unsaved change${pending === 1 ? "" : "s"}`}
        </span>
        <button onClick={save} disabled={busy || pending === 0} className="btn-primary btn-sm">
          {busy ? t("common.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}

function LogoField({ value, onChange, onClear, onUpload, busy }: {
  value: string; onChange: (e: any) => void; onClear: () => void;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void; busy: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <Field label="Logo" hint="Shown at the top left of the printed document. Leave blank for initials.">
      <div className="flex items-start gap-3">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-ink-100 bg-ink-50">
          {value
            ? /* eslint-disable-next-line @next/next/no-img-element */
              <img src={value} alt="Business logo" className="h-full w-full object-contain" />
            : <span className="text-[10px] text-ink-400">No logo</span>}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="btn-outline btn-sm">
              {value ? "Replace image" : "Upload image"}
            </button>
            {value && <button type="button" onClick={onClear} className="btn-outline btn-sm text-red-600">Remove</button>}
          </div>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={onUpload} />
          <input className="input" value={value} onChange={onChange} placeholder="…or paste an image URL" />
        </div>
      </div>
    </Field>
  );
}

/**
 * Booking reminders: which lead times are on, stored as "1,3". Sent once a day
 * at about 8am to the bell, and to phones that have reminders switched on.
 */
function ReminderDays({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const on = new Set(value.split(",").filter(Boolean));
  const toggle = (d: string) => {
    const next = new Set(on);
    if (next.has(d)) next.delete(d); else next.add(d);
    onChange(["1", "3"].filter((x) => next.has(x)).join(","));
  };
  return (
    <div className="space-y-1.5 border-t border-ink-100 pt-3">
      <p className="text-sm font-medium text-ink-700">Booking reminders</p>
      <p className="text-xs text-ink-400">Sent each morning at about 8am for upcoming bookings. Tick both for two reminders, or neither to turn them off.</p>
      <div className="flex flex-wrap gap-4">
        {[["1", "1 day before"], ["3", "3 days before"]].map(([d, label]) => (
          <label key={d} className="flex items-center gap-2 text-sm text-ink-600">
            <input type="checkbox" checked={on.has(d)} onChange={() => toggle(d)} /> {label}
          </label>
        ))}
      </div>
    </div>
  );
}

function Card({ title, children }: any) {
  return (
    <div className="card card-pad">
      <p className="section-title mb-3">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}
