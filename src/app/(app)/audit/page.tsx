"use client";
import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useAction, Empty } from "@/components/ui";
import PageHeader from "@/components/PageHeader";

const SOURCES: Record<string, string> = { ui: "bg-ink-100 text-ink-600", assistant: "bg-brand-100 text-brand-700", system: "bg-purple-100 text-purple-700" };

export default function Audit() {
  const t = useT();
  const [source, setSource] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, loading } = useAction<any[]>("audit.list", { ...(source ? { source } : {}), limit: 200 });

  return (
    <div>
      <PageHeader title={t("nav.audit")} subtitle="Every action taken in the system, including by the AI assistant" actions={
        <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5 text-xs font-medium">
          {[["", t("common.all")], ["ui", "Manual"], ["assistant", "AI assistant"], ["system", "System"]].map(([k, label]) => (
            <button key={k} onClick={() => setSource(k)}
              className={`rounded-md px-2.5 py-1.5 transition ${source === k ? "bg-brand-600 text-white" : "text-ink-500 hover:text-ink-800"}`}>{label}</button>
          ))}
        </div>} />

      <div className="card overflow-hidden">
        {loading ? <p className="p-4 text-sm text-ink-400">{t("common.loading")}</p>
        : !data?.length ? <Empty text={t("common.empty")} />
        : <div className="divide-y divide-ink-50">
            {data.map((a) => (
              <div key={a.id}>
                <button onClick={() => setExpanded(expanded === a.id ? null : a.id)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-ink-50">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${a.ok ? "bg-emerald-400" : "bg-red-400"}`} />
                  <span className="w-44 shrink-0 truncate font-mono text-xs font-medium text-ink-800">{a.action}</span>
                  <span className={`badge shrink-0 ${SOURCES[a.source] ?? "bg-ink-100"}`}>{a.source}</span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-400">{a.actorName}</span>
                  <span className="shrink-0 whitespace-nowrap text-[11px] text-ink-400">
                    {new Date(a.createdAt).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                </button>
                {expanded === a.id && (
                  <div className="grid gap-3 bg-ink-50/60 px-4 py-3 sm:grid-cols-2">
                    <div><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Input</p>
                      <pre className="max-h-48 overflow-auto rounded-lg bg-white p-2 text-[10px] leading-relaxed text-ink-600">{pretty(a.payload)}</pre></div>
                    <div><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Result</p>
                      <pre className="max-h-48 overflow-auto rounded-lg bg-white p-2 text-[10px] leading-relaxed text-ink-600">{pretty(a.result)}</pre></div>
                  </div>
                )}
              </div>
            ))}
          </div>}
      </div>
    </div>
  );
}

function pretty(v: string | null) {
  if (!v) return "—";
  try { return JSON.stringify(JSON.parse(v), null, 2); } catch { return v; }
}
