"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./I18nProvider";
import ActionReview from "./ActionReview";
import { refreshAll } from "./ui";

type Msg = { role: "user" | "assistant" | "system"; content: string; actions?: { name: string; ok: boolean }[] };
type Confirm = { action: string; input: any; toolCallId: string; title: string; category?: string };

const SUGGESTIONS = [
  "Summarize today's business activity",
  "Show me tomorrow's jobs",
  "Which customers haven't paid yet?",
  "How much did we make this month?",
  "Record RM120 petrol expense for today",
  "Which service generated the most revenue this month?",
];

/** Minimal markdown: bold, inline code, bullets and line breaks. */
function render(text: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, '<code class="rounded bg-ink-100 px-1 py-0.5 text-[11px]">$1</code>')
    .replace(/^[-*]\s+(.*)$/gm, '<span class="flex gap-1.5"><span class="text-ink-300">•</span><span>$1</span></span>')
    .replace(/\n/g, "<br/>");
}

export default function Assistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => { scroller.current?.scrollTo({ top: 1e6, behavior: "smooth" }); }, [msgs, busy, confirm]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && !busy && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, busy, onClose]);

  async function post(body: any) {
    setBusy(true); setConfirm(null);
    try {
      const r = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread, ...body }) });
      const j = await r.json();
      if (!j.ok) {
        setMsgs((m) => [...m, { role: "system", content: j.error === "NO_API_KEY" ? t("ai.noKey") : j.error }]);
        return;
      }
      setThread(j.threadId);
      const actions = (j.events ?? []).filter((e: any) => e.type === "action").map((e: any) => ({ name: e.name, ok: e.ok }));
      if (j.message || actions.length) setMsgs((m) => [...m, { role: "assistant", content: j.message || "", actions }]);
      if (j.confirm) setConfirm(j.confirm);
      // A write may have changed what the page behind the drawer is showing.
      if (actions.some((a: any) => a.ok)) { router.refresh(); refreshAll(); }
    } catch (e: any) {
      setMsgs((m) => [...m, { role: "system", content: e.message }]);
    } finally { setBusy(false); }
  }

  function send(text?: string) {
    const msg = (text ?? input).trim();
    if (!msg || busy || confirm) return;
    setMsgs((m) => [...m, { role: "user", content: msg }]);
    setInput("");
    post({ message: msg });
  }

  async function reset() {
    if (thread) await fetch("/api/ai/chat", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId: thread }) });
    setMsgs([]); setThread(null); setConfirm(null);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end no-print" onClick={onClose}>
      <div className="absolute inset-0 bg-ink-900/25 backdrop-blur-[1px]" />
      <div onClick={(e) => e.stopPropagation()}
        className="relative flex h-full w-full flex-col bg-white shadow-2xl sm:w-[440px]">

        <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3 9.8 8.8 4 11l5.8 2.2L12 19l2.2-5.8L20 11l-5.8-2.2z"/></svg>
          </div>
          <p className="flex-1 text-sm font-semibold text-ink-900">{t("ai.title")}</p>
          {msgs.length > 0 && (
            <button disabled={busy} onClick={reset} className="rounded-lg px-2 py-1 text-[11px] font-medium text-ink-400 hover:bg-ink-100 hover:text-ink-700">{t("ai.clear")}</button>
          )}
          <button onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          {msgs.length === 0 && (
            <div className="pt-6">
              <p className="text-center text-sm text-ink-400">{t("ai.intro")}</p>
              <div className="mt-5 space-y-1.5">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => send(s)}
                    className="w-full rounded-lg border border-ink-200 px-3 py-2 text-left text-xs text-ink-600 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {msgs.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
              {m.role === "user" ? (
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-sm text-white">{m.content}</div>
              ) : m.role === "system" ? (
                <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{m.content}</div>
              ) : (
                <div className="max-w-[92%]">
                  {!!m.actions?.length && (
                    <div className="mb-1.5 flex flex-wrap gap-1">
                      {m.actions.map((a, n) => (
                        <span key={n} className={`badge ${a.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d={a.ok ? "m5 13 4 4L19 7" : "M18 6 6 18M6 6l12 12"}/></svg>
                          {a.name}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.content && (
                    <div className="rounded-2xl rounded-bl-md bg-ink-100 px-3.5 py-2.5 text-sm leading-relaxed text-ink-800"
                      dangerouslySetInnerHTML={{ __html: render(m.content) }} />
                  )}
                </div>
              )}
            </div>
          ))}

          {confirm && (
            <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-3.5">
              <div className="mb-1.5 flex items-center gap-1.5">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-amber-600"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0"/></svg>
                <p className="text-xs font-semibold text-amber-900">{t("ai.confirmTitle")}</p>
              </div>
              <p className="text-xs text-amber-800">{confirm.title}</p>
              <ActionReview action={confirm.action} input={confirm.input} />
              <div className="mt-2.5 flex gap-2">
                <button onClick={() => post({ confirm })} className="btn-primary btn-sm flex-1">{t("ai.confirmRun")}</button>
                <button onClick={() => {
                    post({ confirm: { cancelled: true, toolCallId: confirm.toolCallId } });
                  }}
                  className="btn-outline btn-sm flex-1">{t("ai.confirmCancel")}</button>
              </div>
            </div>
          )}

          {busy && (
            <div className="flex items-center gap-2 text-xs text-ink-400">
              <span className="flex gap-1">
                {[0,1,2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-300" style={{ animationDelay: `${i*120}ms` }} />)}
              </span>
              {t("ai.thinking")}
            </div>
          )}
        </div>

        <div className="border-t border-ink-100 p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={t("ai.placeholder")} rows={1}
              className="input max-h-32 min-h-[40px] resize-none py-2.5" />
            <button onClick={() => send()} disabled={busy || !!confirm || !input.trim()} className="btn-primary h-10 w-10 shrink-0 p-0">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m22 2-7 20-4-9-9-4z"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
