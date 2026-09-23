"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useEffect, type ReactNode } from "react";
import { useT, LocaleToggle } from "./I18nProvider";
import { callAction } from "./ui";
import Assistant from "./Assistant";
import type { Role } from "@/lib/auth";

type Item = { href: string; key: string; icon: ReactNode; roles: Role[] };

const I = (d: string) => <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: d }} />;

const GROUPS: { key: string; items: Item[] }[] = [
  { key: "nav.group.operations", items: [
    { href: "/dashboard", key: "nav.dashboard", roles: ["OWNER","ADMIN","STAFF"], icon: I('<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>') },
    { href: "/calendar", key: "nav.calendar", roles: ["OWNER","ADMIN","STAFF"], icon: I('<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>') },
    { href: "/bookings", key: "nav.bookings", roles: ["OWNER","ADMIN"], icon: I('<path d="M8 2v4M16 2v4"/><rect x="3" y="4" width="18" height="17" rx="2"/><path d="m9 15 2 2 4-4"/>') },
    { href: "/jobs", key: "nav.jobs", roles: ["OWNER","ADMIN","STAFF"], icon: I('<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>') },
    { href: "/customers", key: "nav.customers", roles: ["OWNER","ADMIN"], icon: I('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/>') },
    { href: "/staff", key: "nav.staff", roles: ["OWNER","ADMIN"], icon: I('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>') },
    { href: "/services", key: "nav.services", roles: ["OWNER","ADMIN"], icon: I('<path d="M3 6h18M3 12h18M3 18h18"/><circle cx="7" cy="6" r="1.5" fill="currentColor"/><circle cx="14" cy="12" r="1.5" fill="currentColor"/><circle cx="10" cy="18" r="1.5" fill="currentColor"/>') },
  ] },
  { key: "nav.group.money", items: [
    { href: "/quotes", key: "nav.quotes", roles: ["OWNER","ADMIN"], icon: I('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/>') },
    { href: "/invoices", key: "nav.invoices", roles: ["OWNER","ADMIN"], icon: I('<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2z"/><path d="M9 9h6M9 13h6"/>') },
    { href: "/payments", key: "nav.payments", roles: ["OWNER","ADMIN"], icon: I('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>') },
    { href: "/expenses", key: "nav.expenses", roles: ["OWNER","ADMIN","STAFF"], icon: I('<path d="M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>') },
    { href: "/payroll", key: "nav.payroll", roles: ["OWNER","ADMIN"], icon: I('<rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 8v8M18 8v8"/>') },
    { href: "/reports", key: "nav.reports", roles: ["OWNER","ADMIN"], icon: I('<path d="M3 3v18h18"/><path d="m7 14 3-4 4 3 5-7"/>') },
  ] },
  { key: "nav.group.admin", items: [
    { href: "/users", key: "nav.users", roles: ["OWNER"], icon: I('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m19 8 2 2 3-3"/>') },
    { href: "/audit", key: "nav.audit", roles: ["OWNER","ADMIN"], icon: I('<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>') },
    { href: "/settings", key: "nav.settings", roles: ["OWNER","ADMIN"], icon: I('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>') },
  ] },
];

export default function Shell({ user, children }: { user: { id: string; name: string; role: Role }; children: ReactNode }) {
  const t = useT();
  const path = usePathname();
  const router = useRouter();
  const [mobileNav, setMobileNav] = useState(false);
  const [ai, setAi] = useState(false);
  const [notes, setNotes] = useState<any[]>([]);
  const [unread, setUnread] = useState(0);
  const [bell, setBell] = useState(false);
  // Ids that were unread when the bell was opened. The badge clears as soon as
  // the bell opens, but these stay highlighted while it is open so it is still
  // clear which ones are new.
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  useEffect(() => { setMobileNav(false); }, [path]);
  // Once per session, then on a slow poll and whenever the tab comes back into
  // focus. This used to re-fetch on every navigation, putting a request in front
  // of each page change for a bell badge.
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/notifications").then((r) => r.json())
      .then((j) => { if (alive) { setNotes(j.items ?? []); setUnread(j.unread ?? 0); } }).catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => { alive = false; clearInterval(id); document.removeEventListener("visibilitychange", onFocus); };
  }, []);

  const bellPost = (op: "read" | "dismiss", id?: string) =>
    fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op, id }) }).catch(() => {});

  function toggleBell() {
    if (bell) { setBell(false); return; }
    setBell(true);
    setFresh(new Set(notes.filter((n) => !n.read).map((n) => n.id)));
    if (unread > 0) {
      setUnread(0);
      setNotes((ns) => ns.map((n) => ({ ...n, read: true })));
      bellPost("read");
    }
  }
  function dismiss(id: string) {
    setNotes((ns) => ns.filter((n) => n.id !== id));
    bellPost("dismiss", id);
  }
  function clearAll() {
    setNotes([]); setUnread(0);
    bellPost("dismiss");
  }

  async function signOut() {
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login"); router.refresh();
  }

  // prefetch is off on the nav links below on purpose. Adding a loading boundary
  // to the (app) segment switches Next's automatic prefetching on for these
  // dynamic routes, and all fifteen are in the viewport at once on desktop --
  // so every page view would fan out into fifteen server renders, each one
  // running the layout's getUser(). The loading boundary already makes the click
  // feel immediate; this keeps that from costing fifteen invocations a page.
  const nav = (
    <nav className="flex flex-col gap-5 px-3 py-4">
      {GROUPS.map((g) => {
        const items = g.items.filter((i) => i.roles.includes(user.role));
        if (!items.length) return null;
        return (
          <div key={g.key}>
            <p className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-ink-300">{t(g.key)}</p>
            <div className="space-y-0.5">
              {items.map((i) => {
                const active = path === i.href || path.startsWith(i.href + "/");
                return (
                  <Link key={i.href} href={i.href} prefetch={false}
                    className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition ${
                      active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900"}`}>
                    <span className={active ? "text-brand-600" : "text-ink-400"}>{i.icon}</span>
                    {t(i.key)}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-200/70 bg-white lg:flex no-print">
        <Link href="/dashboard" className="flex items-center gap-2.5 border-b border-ink-100 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 21h18M6 21V10l6-7 6 7v11M10 21v-5h4v5"/></svg>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold tracking-tight text-ink-900">{t("app.name")}</p>
            <p className="truncate text-[11px] text-ink-400">{t("app.tagline")}</p>
          </div>
        </Link>
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <div className="border-t border-ink-100 p-3">
          <button onClick={() => setAi(true)} className="mb-2 flex w-full items-center gap-2 rounded-lg bg-gradient-to-r from-brand-600 to-brand-500 px-3 py-2.5 text-sm font-medium text-white shadow-sm transition hover:from-brand-700 hover:to-brand-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3 9.8 8.8 4 11l5.8 2.2L12 19l2.2-5.8L20 11l-5.8-2.2z"/></svg>
            {t("nav.assistant")}
          </button>
          <div className="flex items-center justify-between rounded-lg px-1.5 py-1">
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-ink-700">{user.name}</p>
              <p className="text-[10px] uppercase tracking-wide text-ink-400">{user.role}</p>
            </div>
            <button onClick={signOut} title={t("auth.signOut")} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-700">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile drawer */}
      {mobileNav && (
        <div className="fixed inset-0 z-40 lg:hidden no-print" onClick={() => setMobileNav(false)}>
          <div className="absolute inset-0 bg-ink-900/30" />
          <div className="absolute inset-y-0 left-0 w-64 overflow-y-auto bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3.5">
              <p className="text-sm font-semibold text-ink-900">{t("app.name")}</p>
              <button onClick={() => setMobileNav(false)} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
              </button>
            </div>
            {nav}
            <div className="border-t border-ink-100 p-3">
              <button onClick={signOut} className="btn-outline w-full">{t("auth.signOut")}</button>
            </div>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-ink-200/70 bg-white/90 px-3 py-2.5 backdrop-blur sm:px-5 no-print">
          <button onClick={() => setMobileNav(true)} className="rounded-lg p-2 text-ink-500 hover:bg-ink-100 lg:hidden">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
          </button>
          <div className="flex-1" />
          <LocaleToggle />
          <div className="relative">
            <button onClick={toggleBell} aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative rounded-lg p-2 text-ink-500 hover:bg-ink-100">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0"/></svg>
              {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
            </button>
            {bell && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setBell(false)} />
                <div className="absolute right-0 z-20 mt-1 w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-ink-100 px-3.5 py-2">
                    <span className="text-xs font-semibold text-ink-600">Notifications</span>
                    {notes.length > 0 && (
                      <button onClick={clearAll} className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ink-400 hover:bg-ink-100 hover:text-ink-700">Clear all</button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notes.length === 0 && <p className="px-3.5 py-6 text-center text-xs text-ink-400">You're all caught up</p>}
                    {notes.map((n) => (
                      <div key={n.id} className={`group relative border-b border-ink-50 hover:bg-ink-50 ${fresh.has(n.id) ? "bg-brand-50/40" : ""}`}>
                        <Link href={n.link ?? "#"} onClick={() => setBell(false)} className="block py-2.5 pl-3.5 pr-9">
                          <p className="text-xs font-medium text-ink-800">{n.title}</p>
                          {n.body && <p className="mt-0.5 text-[11px] text-ink-400">{n.body}</p>}
                          <p className="mt-0.5 text-[10px] text-ink-300">{new Date(n.createdAt).toLocaleString("en-MY")}</p>
                        </Link>
                        <button onClick={() => dismiss(n.id)} title="Dismiss" aria-label={`Dismiss ${n.title}`}
                          className="absolute right-2 top-2 rounded-md p-1 text-ink-300 opacity-60 transition hover:bg-ink-200 hover:text-ink-700 group-hover:opacity-100 focus:opacity-100">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6 6 18M6 6l12 12"/></svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
          <button onClick={() => setAi(true)} className="btn-primary btn-sm lg:hidden">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3 9.8 8.8 4 11l5.8 2.2L12 19l2.2-5.8L20 11l-5.8-2.2z"/></svg>
            AI
          </button>
        </header>

        <main className="min-w-0 flex-1 p-3 sm:p-5">{children}</main>
      </div>

      <Assistant open={ai} onClose={() => setAi(false)} />
    </div>
  );
}
