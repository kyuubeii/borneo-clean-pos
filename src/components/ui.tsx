"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

/* ------------------------------ Status badges ----------------------------- */
const TONES: Record<string, string> = {
  SCHEDULED: "bg-ink-100 text-ink-600", EN_ROUTE: "bg-amber-100 text-amber-700",
  IN_PROGRESS: "bg-blue-100 text-blue-700", COMPLETED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-red-100 text-red-600",
  PENDING: "bg-amber-100 text-amber-700", CONFIRMED: "bg-blue-100 text-blue-700",
  DRAFT: "bg-ink-100 text-ink-600", SENT: "bg-blue-100 text-blue-700",
  PARTIAL: "bg-amber-100 text-amber-700", PAID: "bg-emerald-100 text-emerald-700",
  OVERDUE: "bg-red-100 text-red-600", VOID: "bg-ink-100 text-ink-400",
  ACCEPTED: "bg-emerald-100 text-emerald-700", DECLINED: "bg-red-100 text-red-600",
  EXPIRED: "bg-ink-100 text-ink-400",
};
export function Badge({ status, label }: { status: string; label?: string }) {
  return <span className={`badge ${TONES[status] ?? "bg-ink-100 text-ink-600"}`}>{label ?? status}</span>;
}

/* --------------------------------- Modal ---------------------------------- */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", h); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/30 p-0 sm:p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"} max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-white shadow-xl`}>
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-ink-100 bg-white px-5 py-3.5">
          <h2 className="text-base font-semibold text-ink-900">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* --------------------------------- Fields --------------------------------- */
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div><label className="label">{label}</label>{children}{hint && <p className="mt-1 text-[11px] text-ink-400">{hint}</p>}</div>;
}

export function Money({ cents, className = "", sign = false }: { cents: number; className?: string; sign?: boolean }) {
  const s = (Math.abs(cents) / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const neg = cents < 0;
  return <span className={`whitespace-nowrap tabular-nums ${className}`}>{neg ? "−" : sign ? "+" : ""}RM {s}</span>;
}

export function Stat({ label, value, sub, tone = "default" }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "good" | "warn" | "bad" }) {
  const t = { default: "text-ink-900", good: "text-emerald-600", warn: "text-amber-600", bad: "text-red-600" }[tone];
  return (
    <div className="card card-pad">
      <p className="text-xs font-medium text-ink-400">{label}</p>
      <p className={`mt-1.5 text-lg font-semibold tracking-tight sm:text-xl xl:text-2xl ${t}`}>{value}</p>
      {sub && <p className="mt-1 text-[11px] leading-snug text-ink-400">{sub}</p>}
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink-200">
      <path d="M3 7h18M3 12h18M3 17h10"/></svg>
    <p className="text-sm text-ink-400">{text}</p>
  </div>;
}

/* ------------------------------ Action client ----------------------------- */
/** Calls an action through the same registry the assistant uses. */
export async function callAction(name: string, input: unknown = {}): Promise<any> {
  const r = await fetch(`/api/actions/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error ?? "Action failed");
  return j.data;
}

/** Lets a write anywhere (notably the AI assistant) re-fetch every live useAction. */
const refreshListeners = new Set<() => void>();
export const refreshAll = () => refreshListeners.forEach((l) => l());

export function useAction<T>(name: string, input: unknown = {}, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(input);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((x) => x + 1);
    refreshListeners.add(l);
    return () => { refreshListeners.delete(l); };
  }, []);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    callAction(name, input)
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key, tick, ...deps]);
  return { data, loading, error, refresh: () => setTick((t) => t + 1) };
}

/* -------------------------------- Toasts ---------------------------------- */
let pushToast: ((m: string, tone?: "ok" | "err") => void) | null = null;
export const toast = (m: string, tone: "ok" | "err" = "ok") => pushToast?.(m, tone);

export function Toaster() {
  const [items, setItems] = useState<{ id: number; m: string; tone: string }[]>([]);
  useEffect(() => {
    pushToast = (m, tone = "ok") => {
      const id = Date.now() + Math.random();
      setItems((x) => [...x, { id, m, tone }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 4000);
    };
    return () => { pushToast = null; };
  }, []);
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 flex-col gap-2 no-print">
      {items.map((i) => (
        <div key={i.id} className={`rounded-lg px-4 py-2.5 text-sm font-medium text-white shadow-lg ${i.tone === "err" ? "bg-red-600" : "bg-ink-900"}`}>{i.m}</div>
      ))}
    </div>
  );
}
