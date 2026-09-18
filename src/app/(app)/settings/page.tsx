"use client";
import { useState, useEffect } from "react";
import { useT } from "@/components/I18nProvider";
import { useAction, Field, callAction, toast } from "@/components/ui";
import PageHeader from "@/components/PageHeader";

const MODELS = [
  "anthropic/claude-sonnet-4.5", "anthropic/claude-opus-4.1", "anthropic/claude-haiku-4.5",
  "openai/gpt-4.1", "google/gemini-2.5-pro", "meta-llama/llama-3.3-70b-instruct",
];

export default function Settings() {
  const t = useT();
  const { data, loading, refresh } = useAction<Record<string, string>>("settings.get", {});
  const [f, setF] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (data) setF(data); }, [data]);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? String(e.target.checked) : e.target.value });

  async function save(keys: string[]) {
    setBusy(true);
    try {
      const values: Record<string, string> = {};
      for (const k of keys) if (f[k] !== undefined) values[k] = f[k];
      if (keys.includes("ai.model") && apiKey.trim()) values["ai.apiKey"] = apiKey.trim();
      await callAction("settings.update", { values });
      toast("Settings saved"); setApiKey(""); refresh();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  if (loading) return <p className="text-sm text-ink-400">{t("common.loading")}</p>;

  return (
    <div className="max-w-3xl space-y-4">
      <PageHeader title={t("nav.settings")} />

      <Card title="Business profile" onSave={() => save(["business.name","business.email","business.phone","business.address","business.regNo"])} busy={busy}>
        <Field label="Business name"><input className="input" value={f["business.name"] ?? ""} onChange={set("business.name")} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("common.email")}><input className="input" value={f["business.email"] ?? ""} onChange={set("business.email")} /></Field>
          <Field label={t("common.phone")}><input className="input" value={f["business.phone"] ?? ""} onChange={set("business.phone")} /></Field>
        </div>
        <Field label={t("common.address")}><textarea className="input" rows={2} value={f["business.address"] ?? ""} onChange={set("business.address")} /></Field>
        <Field label="Registration number"><input className="input" value={f["business.regNo"] ?? ""} onChange={set("business.regNo")} /></Field>
      </Card>

      <Card title="Invoice defaults" onSave={() => save(["invoice.taxRateBp","invoice.dueDays","invoice.footer"])} busy={busy}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tax rate (basis points)" hint="600 = 6% SST">
            <input className="input" value={f["invoice.taxRateBp"] ?? "0"} onChange={set("invoice.taxRateBp")} /></Field>
          <Field label="Payment terms (days)"><input className="input" value={f["invoice.dueDays"] ?? "14"} onChange={set("invoice.dueDays")} /></Field>
        </div>
        <Field label="Invoice footer"><textarea className="input" rows={2} value={f["invoice.footer"] ?? ""} onChange={set("invoice.footer")} /></Field>
      </Card>

      <Card title="Notifications" onSave={() => save(["notify.bookingConfirmation","notify.reminders","notify.paymentReminders"])} busy={busy}>
        <p className="text-xs text-ink-400">Notifications are delivered in-app. Email and SMS delivery are not configured in this version.</p>
        {[["notify.bookingConfirmation","Booking confirmations"],["notify.reminders","Job and schedule reminders"],["notify.paymentReminders","Payment reminders"]].map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 text-sm text-ink-600">
            <input type="checkbox" checked={f[k] === "true"} onChange={set(k)} /> {label}
          </label>
        ))}
      </Card>

      <Card title="AI Assistant" onSave={() => save(["ai.model"])} busy={busy}>
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
    </div>
  );
}

function Card({ title, children, onSave, busy }: any) {
  const t = useT();
  return (
    <div className="card card-pad">
      <p className="section-title mb-3">{title}</p>
      <div className="space-y-3">{children}</div>
      <div className="mt-4 flex justify-end border-t border-ink-100 pt-3">
        <button onClick={onSave} disabled={busy} className="btn-primary btn-sm">{busy ? t("common.saving") : t("common.save")}</button>
      </div>
    </div>
  );
}
