"use client";
import { useEffect, useState } from "react";
import { callAction, useAction, LoadError } from "./ui";
import { CustomerForm } from "./CustomerForm";

export default function CustomerPicker({ value, onChange, disabled = false }: {
  value: string; onChange: (id: string, customer?: any) => void; disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => { const timer = setTimeout(() => setSearch(query), 200); return () => clearTimeout(timer); }, [query]);
  const result = useAction<any[]>("customers.search", { query: search || undefined, limit: 20 });
  useEffect(() => {
    let alive = true;
    setSelected(null); setSelectionError("");
    if (value) callAction("customers.get", { customerId: value }).then((c) => {
      if (alive) { setSelected(c); onChange(value, c); }
    }).catch((e) => { if (alive) setSelectionError(e.message); });
    return () => { alive = false; };
    // The callback changes with the parent render; selection depends on the ID.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, retry]);
  return <div className="space-y-2">
    {selectionError && <LoadError error={selectionError} onRetry={() => setRetry(x => x + 1)} />}
    {selected && <div className="flex items-center justify-between rounded-lg bg-brand-50 p-2 text-sm">
      <span>{selected.name}{selected.company ? ` · ${selected.company}` : ""}</span>
      {!disabled && <button type="button" className="btn-ghost btn-sm" onClick={() => onChange("")}>Change</button>}
    </div>}
    {!disabled && !value && <>
      <input className="input" aria-label="Search customers" placeholder="Search name, phone or company…" value={query} onChange={e => setQuery(e.target.value)} />
      {result.error ? <LoadError error={result.error} onRetry={result.refresh} /> : result.loading ? <p className="text-xs text-ink-500">Loading customers…</p> :
        <div className="max-h-40 overflow-y-auto rounded-lg border border-ink-200">
          {result.data?.length ? result.data.map(c => <button type="button" key={c.id} className="block w-full px-3 py-2 text-left text-xs hover:bg-brand-50" onClick={() => onChange(c.id, c)}>
            <strong>{c.name}</strong> {c.company || c.phone}
          </button>) : <p className="p-3 text-xs text-ink-500">No matching customers.</p>}
        </div>}
      <button type="button" className="btn-ghost btn-sm" onClick={() => setCreating(true)}>+ New customer</button>
    </>}
    {value && !selected && !selectionError && <p className="text-xs text-ink-500">Loading selected customer…</p>}
    <CustomerForm open={creating} onClose={() => setCreating(false)} onDone={c => { if (c) onChange(c.id, c); setCreating(false); result.refresh(); }} />
  </div>;
}
