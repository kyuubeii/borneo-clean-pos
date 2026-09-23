"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "./I18nProvider";
import ActionReview from "./ActionReview";
import { refreshAll } from "./ui";
import { useCurrentUser } from "./UserProvider";

type Msg = { role: "user" | "assistant" | "system"; content: string; actions?: { name: string; ok: boolean }[] };
type Confirm = { action: string; input: any; toolCallId: string; title: string; category?: string };
type Thread = { id: string; title: string; updatedAt: string };

/** Safe localStorage: private windows and blocked storage throw. */
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string | null) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
};

/** Today / Yesterday / Previous 7 days / Previous 30 days / Month Year, like a chat app. */
function groupThreads(threads: Thread[], t: (k: string) => string) {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = day(new Date());
  const groups: { label: string; items: Thread[] }[] = [];
  for (const th of threads) {
    const d = new Date(th.updatedAt);
    const ago = Math.round((today - day(d)) / 86400000);
    const label = ago <= 0 ? t("ai.today") : ago === 1 ? t("ai.yesterday") : ago <= 7 ? t("ai.prev7") : ago <= 30 ? t("ai.prev30")
      : d.toLocaleDateString("en-MY", { month: "long", year: "numeric" });
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(th); else groups.push({ label, items: [th] });
  }
  return groups;
}

const Icon = ({ d, size = 16 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />
);
const ICON = {
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  compose: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  pencil: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
};

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
  const me = useCurrentUser();
  const LAST = `bc.ai.lastThread.${me.id}`, SIDEBAR = "bc.ai.sidebar";
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [thread, setThread] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);
  // Desktop: a docked sidebar the person can collapse. Phone: a slide-over.
  const [sidebar, setSidebar] = useState(true);
  const [drawer, setDrawer] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Thread[] | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => { scroller.current?.scrollTo({ top: 1e6, behavior: "smooth" }); }, [msgs, busy, confirm]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && !busy && !renaming && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, busy, renaming, onClose]);

  const loadThreads = useCallback(async () => {
    try {
      const j = await fetch("/api/ai/threads").then((r) => r.json());
      if (j.ok) setThreads(j.threads);
      return j.ok ? (j.threads as Thread[]) : [];
    } catch { return []; }
  }, []);

  const openThread = useCallback(async (id: string) => {
    setLoadingThread(true); setConfirm(null); setDrawer(false);
    try {
      const j = await fetch(`/api/ai/threads/${encodeURIComponent(id)}`).then((r) => r.json());
      if (!j.ok) throw new Error(j.error);
      setThread(id); setMsgs(j.messages); store.set(LAST, id);
    } catch (e: any) {
      setThread(null); setMsgs([{ role: "system", content: e.message || "Could not open that conversation." }]); store.set(LAST, null);
    } finally { setLoadingThread(false); }
  }, [LAST]);

  // First time the panel opens: fetch the history and pick up where the person left off.
  useEffect(() => {
    if (!open || started.current) return;
    started.current = true;
    if (store.get(SIDEBAR) === "closed") setSidebar(false);
    loadThreads().then((list) => {
      const last = store.get(LAST);
      if (last && list.some((x) => x.id === last)) openThread(last);
    });
  }, [open, loadThreads, openThread, LAST]);

  // Search titles and message text on the server, a moment after typing stops.
  useEffect(() => {
    const term = q.trim();
    if (!term) { setFound(null); return; }
    const id = setTimeout(() => {
      fetch(`/api/ai/threads?q=${encodeURIComponent(term)}`).then((r) => r.json())
        .then((j) => j.ok && setFound(j.threads)).catch(() => {});
    }, 250);
    return () => clearTimeout(id);
  }, [q]);

  const shown = found ?? threads ?? [];
  const groups = useMemo(() => groupThreads(shown, t), [shown, t]);

  async function post(body: any) {
    setBusy(true); setConfirm(null);
    try {
      const r = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread, ...body }) });
      const j = await r.json();
      // A new conversation exists as soon as its first message is stored, even
      // if the model then failed, so it goes into the history either way.
      if (j.threadId) {
        setThread(j.threadId); store.set(LAST, j.threadId);
        const now = new Date().toISOString();
        setThreads((list) => {
          const rest = (list ?? []).filter((x) => x.id !== j.threadId);
          const cur = (list ?? []).find((x) => x.id === j.threadId);
          return [{ id: j.threadId, title: j.title ?? cur?.title ?? t("ai.newChat"), updatedAt: now }, ...rest];
        });
      }
      if (!j.ok) {
        setMsgs((m) => [...m, { role: "system", content: j.error === "NO_API_KEY" ? t("ai.noKey") : j.error }]);
        return;
      }
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

  function newChat() {
    if (busy) return;
    setMsgs([]); setThread(null); setConfirm(null); setDrawer(false); store.set(LAST, null);
  }

  function toggleSidebar() {
    // The docked sidebar only exists on wide screens; below that it is a slide-over.
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setSidebar((v) => { store.set(SIDEBAR, v ? "closed" : "open"); return !v; });
    } else setDrawer((v) => !v);
  }

  async function rename(id: string, title: string) {
    setRenaming(null);
    const clean = title.trim();
    const before = threads?.find((x) => x.id === id)?.title;
    if (!clean || clean === before) return;
    const set = (tt: string) => (list: Thread[] | null) => list?.map((x) => x.id === id ? { ...x, title: tt } : x) ?? list;
    setThreads(set(clean)); setFound(set(clean));
    const j = await fetch(`/api/ai/threads/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: clean }) })
      .then((r) => r.json()).catch(() => ({ ok: false }));
    if (!j.ok && before) { setThreads(set(before)); setFound(set(before)); }
  }

  async function remove(id: string) {
    if (busy || !window.confirm(t("ai.deleteConfirm"))) return;
    const j = await fetch(`/api/ai/threads/${encodeURIComponent(id)}`, { method: "DELETE" }).then((r) => r.json()).catch(() => ({ ok: false }));
    if (!j.ok) return;
    setThreads((list) => list?.filter((x) => x.id !== id) ?? list);
    setFound((list) => list?.filter((x) => x.id !== id) ?? list);
    if (thread === id) newChat();
  }

  if (!open) return null;

  const title = thread ? threads?.find((x) => x.id === thread)?.title ?? t("ai.title") : t("ai.title");

  const history = (
    <div className="flex h-full flex-col">
      <div className="space-y-2 p-3">
        <button onClick={newChat} disabled={busy}
          className="flex w-full items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-sm font-medium text-ink-700 transition hover:border-brand-300 hover:text-brand-700">
          <Icon d={ICON.compose} size={15} /> {t("ai.newChat")}
        </button>
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-300"><Icon d={ICON.search} size={13} /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ai.search")} aria-label={t("ai.search")}
            className="input py-1.5 pl-8 text-xs" />
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 pb-3" aria-label={t("ai.history")}>
        {threads === null ? <p className="px-2 py-4 text-xs text-ink-400">…</p>
        : !shown.length ? <p className="px-2 py-4 text-center text-xs text-ink-400">{q ? t("ai.noMatch") : t("ai.noChats")}</p>
        : groups.map((g) => (
          <div key={g.label} className="mb-3">
            <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-300">{g.label}</p>
            {g.items.map((th) => {
              const active = th.id === thread;
              if (renaming?.id === th.id) return (
                <input key={th.id} autoFocus value={renaming.title} aria-label={t("ai.rename")}
                  onChange={(e) => setRenaming({ id: th.id, title: e.target.value })}
                  onBlur={() => rename(th.id, renaming.title)}
                  onKeyDown={(e) => { if (e.key === "Enter") rename(th.id, renaming.title); if (e.key === "Escape") { e.stopPropagation(); setRenaming(null); } }}
                  className="input my-0.5 py-1.5 text-xs" />
              );
              return (
                <div key={th.id} className={`group relative flex items-center rounded-lg ${active ? "bg-brand-50" : "hover:bg-ink-100"}`}>
                  <button onClick={() => !busy && th.id !== thread && openThread(th.id)} title={th.title}
                    className={`min-w-0 flex-1 truncate px-2 py-1.5 text-left text-xs ${active ? "font-medium text-brand-700" : "text-ink-600"}`}>
                    {th.title}
                  </button>
                  <div className={`flex shrink-0 items-center pr-1 ${active ? "" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"}`}>
                    <button onClick={() => setRenaming({ id: th.id, title: th.title })} title={t("ai.rename")} aria-label={`${t("ai.rename")} ${th.title}`}
                      className="rounded p-1 text-ink-400 hover:bg-white hover:text-ink-700"><Icon d={ICON.pencil} size={12} /></button>
                    <button onClick={() => remove(th.id)} title={t("ai.delete")} aria-label={`${t("ai.delete")} ${th.title}`}
                      className="rounded p-1 text-ink-400 hover:bg-white hover:text-red-600"><Icon d={ICON.trash} size={12} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </nav>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex justify-end no-print" onClick={onClose}>
      <div className="absolute inset-0 bg-ink-900/25 backdrop-blur-[1px]" />
      <div onClick={(e) => e.stopPropagation()}
        className={`relative flex h-full w-full bg-white shadow-2xl sm:w-[440px] ${sidebar ? "lg:w-[760px]" : ""}`}>

        {sidebar && <aside className="hidden w-[260px] shrink-0 border-r border-ink-100 bg-ink-50/60 lg:block">{history}</aside>}

        {/* Phone and tablet: the same history as a slide-over inside the panel. */}
        {drawer && (
          <div className="absolute inset-0 z-10 flex lg:hidden" onClick={() => setDrawer(false)}>
            <div className="h-full w-[82%] max-w-[300px] border-r border-ink-100 bg-ink-50 shadow-xl" onClick={(e) => e.stopPropagation()}>{history}</div>
            <div className="flex-1 bg-ink-900/20" />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-1.5 border-b border-ink-100 px-3 py-3">
            <button onClick={toggleSidebar} title={t("ai.history")} aria-label={t("ai.history")}
              className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"><Icon d={ICON.sidebar} size={17} /></button>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3 9.8 8.8 4 11l5.8 2.2L12 19l2.2-5.8L20 11l-5.8-2.2z"/></svg>
            </div>
            <p className="min-w-0 flex-1 truncate px-1 text-sm font-semibold text-ink-900" title={title}>{title}</p>
            <button disabled={busy} onClick={newChat} title={t("ai.newChat")} aria-label={t("ai.newChat")}
              className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700"><Icon d={ICON.compose} size={16} /></button>
            <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
              <Icon d={ICON.close} size={17} />
            </button>
          </div>

          <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
            {loadingThread && <p className="text-center text-xs text-ink-400">{t("common.loading")}</p>}
            {!loadingThread && msgs.length === 0 && (
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
              <button onClick={() => send()} disabled={busy || loadingThread || !!confirm || !input.trim()} className="btn-primary h-10 w-10 shrink-0 p-0">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m22 2-7 20-4-9-9-4z"/></svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
