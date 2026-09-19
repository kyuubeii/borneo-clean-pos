"use client";
import { useState } from "react";
import { useT, LocaleToggle } from "@/components/I18nProvider";

export default function Login() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const r = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    setBusy(false);
    if (!r.ok) return setErr(t("auth.invalid"));
    // A full navigation rather than router.push: signing in changes what the
    // server will render, and the client router would otherwise serve the
    // /dashboard entry it cached while nobody was signed in -- which bounces
    // straight back here and looks like the password was wrong.
    window.location.assign("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-ink-50 via-white to-brand-50 p-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 21h18M6 21V10l6-7 6 7v11M10 21v-5h4v5"/></svg>
            </div>
            <div>
              <p className="text-base font-semibold tracking-tight text-ink-900">{t("app.name")}</p>
              <p className="text-xs text-ink-400">{t("app.tagline")}</p>
            </div>
          </div>
          <LocaleToggle />
        </div>

        <form onSubmit={submit} className="card card-pad space-y-3.5">
          <div>
            <label className="label">{t("common.email")}</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
          </div>
          <div>
            <label className="label">{t("auth.password")}</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">{err}</p>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? "…" : t("auth.signIn")}</button>
        </form>
      </div>
    </div>
  );
}
