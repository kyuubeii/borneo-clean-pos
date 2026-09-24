"use client";
import { useState, useEffect } from "react";
import { useT, LocaleToggle, useI18n } from "@/components/I18nProvider";
import { Field, Money } from "@/components/ui";
import { minsToLabel, toInput } from "@/lib/dates";

export default function PublicBooking() {
  const t = useT();
  const { locale } = useI18n();
  const [services, setServices] = useState<any[]>([]);
  const [business, setBusiness] = useState<any>({});
  const [picked, setPicked] = useState<string[]>([]);
  const [f, setF] = useState<any>({ name: "", phone: "", email: "", address: "", city: "Kuching", notes: "", startAt: toInput(tomorrow()) });
  const [done, setDone] = useState<any>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { fetch("/api/book").then((r) => r.json()).then((j) => { setServices(j.services ?? []); setBusiness(j.business ?? {}); }); }, []);

  const chosen = services.filter((s) => picked.includes(s.id));
  const total = chosen.reduce((a, s) => a + s.priceCents, 0);
  const duration = chosen.reduce((a, s) => a + s.durationMin, 0);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    const r = await fetch("/api/book", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...f, serviceIds: picked, startAt: new Date(f.startAt).toISOString() }) });
    const j = await r.json();
    setBusy(false);
    if (!j.ok) return setErr(j.error);
    setDone(j);
  }

  if (done) return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 p-4">
      <div className="card card-pad max-w-md text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m5 13 4 4L19 7"/></svg>
        </div>
        <h1 className="text-lg font-semibold text-ink-900">
          {locale === "zh" ? "预约申请已收到" : "Request received"}
        </h1>
        <p className="mt-1.5 text-sm text-ink-500">
          {locale === "zh"
            ? `您的预约编号是 ${done.ref}。我们会尽快致电确认。`
            : `Your reference is ${done.ref}. We'll call you shortly to confirm the time.`}
        </p>
        <p className="mt-3 text-sm font-medium text-ink-700">Estimated <Money cents={done.total} /></p>
        {business.phone && <p className="mt-3 text-xs text-ink-400">{business.name} · {business.phone}</p>}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 21h18M6 21V10l6-7 6 7v11M10 21v-5h4v5"/></svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-ink-900">{business.name ?? t("app.name")}</p>
              <p className="text-[11px] text-ink-400">{locale === "zh" ? "在线预约" : "Book a clean"}</p>
            </div>
          </div>
          <LocaleToggle />
        </div>
      </header>

      <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4 p-4">
        <div className="card card-pad">
          <p className="section-title mb-3">{locale === "zh" ? "选择服务" : "What do you need?"}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {services.map((s) => {
              const on = picked.includes(s.id);
              return (
                <button key={s.id} type="button"
                  onClick={() => setPicked(on ? picked.filter((x) => x !== s.id) : [...picked, s.id])}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-xs transition ${
                    on ? "border-brand-400 bg-brand-50" : "border-ink-200 bg-white hover:bg-ink-50"}`}>
                  <span className="min-w-0">
                    <span className={`block truncate font-medium ${on ? "text-brand-700" : "text-ink-700"}`}>
                      {locale === "zh" && s.nameZh ? s.nameZh : s.name}</span>
                    <span className="text-ink-400">{minsToLabel(s.durationMin)}</span>
                  </span>
                  <Money cents={s.priceCents} className={`ml-2 shrink-0 font-medium ${on ? "text-brand-700" : "text-ink-500"}`} />
                </button>
              );
            })}
          </div>
        </div>

        <div className="card card-pad space-y-3">
          <p className="section-title">{locale === "zh" ? "您的资料" : "Your details"}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={locale === "zh" ? "姓名" : "Name"}><input className="input" required value={f.name} onChange={set("name")} /></Field>
            <Field label={locale === "zh" ? "电话" : "Phone"}><input className="input" required value={f.phone} onChange={set("phone")} /></Field>
          </div>
          <Field label={`${locale === "zh" ? "电邮" : "Email"} (${t("common.optional")})`}><input className="input" type="email" value={f.email} onChange={set("email")} /></Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <Field label={locale === "zh" ? "地址" : "Address"}><input className="input" required value={f.address} onChange={set("address")} /></Field>
            </div>
            <Field label={locale === "zh" ? "城市" : "City"}><input className="input" value={f.city} onChange={set("city")} /></Field>
          </div>
          <Field label={locale === "zh" ? "希望的日期时间" : "Preferred date & time"}>
            <input type="datetime-local" className="input" required value={f.startAt} onChange={set("startAt")} /></Field>
          <Field label={`${locale === "zh" ? "特别要求" : "Anything we should know"} (${t("common.optional")})`}>
            <textarea className="input" rows={2} value={f.notes} onChange={set("notes")} /></Field>
        </div>

        {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">{err}</p>}

        <div className="card card-pad sticky bottom-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs text-ink-500">{chosen.length} {locale === "zh" ? "项服务" : `service${chosen.length === 1 ? "" : "s"}`}
              {duration > 0 && ` · ${minsToLabel(duration)}`}</span>
            <span className="text-lg font-semibold text-ink-900"><Money cents={total} /></span>
          </div>
          <button className="btn-primary w-full" disabled={busy || !picked.length}>
            {busy ? "…" : locale === "zh" ? "提交预约" : "Request booking"}
          </button>
          <p className="mt-2 text-center text-[11px] text-ink-400">
            {locale === "zh" ? "我们会致电确认时间后才正式安排。" : "We'll call to confirm before the job is scheduled."}
          </p>
        </div>
        <p className="pb-2 text-center text-[11px] text-ink-400">
          <a href="/privacy" className="underline hover:text-ink-600">{locale === "zh" ? "隐私政策" : "Privacy policy"}</a>
        </p>
      </form>
    </div>
  );
}

function tomorrow() { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(10, 0, 0, 0); return d; }
