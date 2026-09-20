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
let modalCount = 0;
let originalOverflow = "";
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const h = (e: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== panel.current) return;
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? []).filter(el => el.getClientRects().length);
        const first = items[0], last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    panel.current?.focus();
    window.addEventListener("keydown", h);
    if (modalCount++ === 0) originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", h); if (--modalCount === 0) document.body.style.overflow = originalOverflow; previous?.focus(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/30 p-0 sm:p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onClick={(e) => e.stopPropagation()}
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

/* ---------------------------- Destructive confirm -------------------------- */
/**
 * The one way this app deletes things.
 *
 * Worth knowing: the registry's `requiresConfirm` flag does NOT guard this path.
 * runAction only honours it when the call comes from the assistant, so for a
 * button the confirmation is entirely the UI's job. That is why every delete
 * goes through here rather than a bare window.confirm.
 *
 * `confirmText` arms the button only once it has been typed back, for deletions
 * that take real records with them. Omit it for small, obvious ones.
 * `consequences` is a slot because what is lost differs per record, and vague
 * warnings train people to click through.
 */
export function ConfirmDelete({
  open, onClose, onDone, title, action, input, confirmText, confirmLabel, verb = "Delete",
  children, alternative,
}: {
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
  title: string;
  action: string;
  input: unknown;
  /** Typed back to arm the button; omit when the deletion is minor. */
  confirmText?: string;
  /** What the field asks for, e.g. "the email address". */
  confirmLabel?: string;
  verb?: string;
  /** What this removes, and what it keeps. */
  children: ReactNode;
  /** The non-destructive option, when one exists. */
  alternative?: ReactNode;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const armed = !confirmText || typed.trim().toLowerCase() === confirmText.trim().toLowerCase();

  function close() { setTyped(""); setBusy(false); onClose(); }

  async function go() {
    setBusy(true);
    try {
      const r = await callAction(action, input);
      toast(typeof r?.deleted === "string" ? `${r.deleted} deleted` : `${verb}d`);
      onDone?.();
      close();
    } catch (e: any) {
      toast(humanError(e.message), "err");
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} title={title}>
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-[11px] leading-relaxed text-rose-700">
          {children}
        </div>
        {alternative && <p className="text-[11px] leading-relaxed text-ink-500">{alternative}</p>}
        {confirmText && (
          <Field label={`Type ${confirmLabel ?? "the name"} to confirm`} hint={confirmText}>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)}
              placeholder={confirmText} autoComplete="off" />
          </Field>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={close} className="btn-outline">Cancel</button>
          <button onClick={go} disabled={!armed || busy}
            className="btn-sm rounded-lg bg-rose-600 px-3 py-2 font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-ink-200">
            {busy ? `${verb.replace(/e$/, "")}ing\u2026` : verb}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Registry errors are written for the AI that also calls these actions, so they
 * name actions and fields ("Set active:false with staff.update"). Shown to an
 * owner running a cleaning business, that is noise. Translate the ones a person
 * can actually hit from a button.
 */
export function humanError(msg: string): string {
  if (!msg) return "Something went wrong.";
  return msg
    .replace(/\buse \w+\.\w+\b/gi, "use the relevant screen")
    .replace(/Look the record up first and use the exact id returned; omit optional IDs you do not have\.?/i,
      "Something it refers to no longer exists. Reload the page and try again.")
    .replace(/That record does not exist\. Check the id, or search for it first\.?/i,
      "That record no longer exists. It may already have been deleted.");
}

/* ------------------------------ Action client ----------------------------- */
/**
 * Calls one action through the same registry the assistant uses.
 *
 * This is the write path. It is never batched: a write and a read issued in the
 * same tick must not be able to overtake each other.
 */
export async function callAction(name: string, input: unknown = {}): Promise<any> {
  const r = await fetch(`/api/actions/${name}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(humanError(j.error ?? "Action failed"));
  return j.data;
}

/* --- Read batching -------------------------------------------------------- */
/**
 * Reads issued in the same tick go out as one request.
 *
 * Mounting a page fires every useAction at once. Sent separately they each pay
 * for their own authentication round trip and compete for the same database
 * connections; the dashboard alone did this seven times over.
 */
type Queued = { name: string; input: unknown; resolve: (v: any) => void; reject: (e: any) => void };
let queue: Queued[] = [];
let scheduled = false;

async function flush() {
  const batch = queue;
  queue = [];
  scheduled = false;
  if (batch.length === 0) return;

  // A lone read is cheaper as a plain call than wrapped in a batch envelope.
  if (batch.length === 1) {
    const only = batch[0];
    try { only.resolve(await callAction(only.name, only.input)); } catch (e) { only.reject(e); }
    return;
  }

  try {
    const r = await fetch("/api/actions/batch", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calls: batch.map((b) => ({ name: b.name, input: b.input })) }),
    });
    const j = await r.json();
    if (!j.ok || !Array.isArray(j.results)) throw new Error(j.error ?? "Batch failed");

    await Promise.all(batch.map(async (b, i) => {
      const res = j.results[i];
      if (res?.ok) return b.resolve(res.data);
      // An action the batch endpoint will not run (a write, say) still works on
      // its own, so fall back rather than surfacing an error the caller cannot act on.
      if (res?.code === "NOT_BATCHABLE") {
        try { return b.resolve(await callAction(b.name, b.input)); } catch (e) { return b.reject(e); }
      }
      b.reject(new Error(res?.error ?? "Action failed"));
    }));
  } catch (e) {
    // The batch route itself failed. Retry each call individually so a single
    // broken endpoint cannot take down every read on the page.
    await Promise.all(batch.map(async (b) => {
      try { b.resolve(await callAction(b.name, b.input)); } catch (err) { b.reject(err); }
    }));
  }
}

/** Queue a read-only action; resolves with its data, same shape as callAction. */
export function queueAction(name: string, input: unknown = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    queue.push({ name, input, resolve, reject });
    if (!scheduled) { scheduled = true; queueMicrotask(flush); }
  });
}

/** Lets a write anywhere (notably the AI assistant) re-fetch every live useAction. */
const refreshListeners = new Set<() => void>();
export const refreshAll = () => refreshListeners.forEach((l) => l());

export function useAction<T>(name: string, input: unknown = {}, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(input);
  const [tick, setTick] = useState(0);
  // What the data on screen was fetched for. A re-fetch for the same question
  // keeps the old answer visible; a different question does not.
  const shownKey = useRef<string | null>(null);

  useEffect(() => {
    const l = () => setTick((x) => x + 1);
    refreshListeners.add(l);
    return () => { refreshListeners.delete(l); };
  }, []);

  useEffect(() => {
    let alive = true;
    // Blanking the screen to a spinner on every refresh is what made writes and
    // drag-and-drop feel laggy: the rows vanished and came back. Keep them.
    const sameQuestion = shownKey.current === key;
    if (!sameQuestion) setData(null);
    if (sameQuestion) setRefreshing(true); else setLoading(true);

    queueAction(name, input)
      .then((d) => { if (alive) { setData(d); setError(null); shownKey.current = key; } })
      .catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) { setLoading(false); setRefreshing(false); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key, tick, ...deps]);

  return { data, loading, refreshing, error, refresh: () => setTick((t) => t + 1) };
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

export function LoadError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (!error) return null;
  return <div role="alert" className="my-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
    <p>Unable to load this information. {humanError(error)}</p>
    <button type="button" className="btn-outline btn-sm mt-2" onClick={onRetry}>Try again</button>
  </div>;
}
