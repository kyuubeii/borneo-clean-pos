"use client";
import { useEffect, useState } from "react";
import { callAction } from "./ui";
import { fmt } from "@/lib/money";

const LOOKUPS: Record<string, [string, string]> = {
  customerId: ["customers.get", "customerId"], bookingId: ["bookings.get", "bookingId"],
  jobId: ["jobs.get", "jobId"], invoiceId: ["invoices.get", "invoiceId"], quoteId: ["quotes.get", "quoteId"],
};
export default function ActionReview({ action, input }: { action: string; input: Record<string, any> }) {
  const [names, setNames] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true; setNames({});
    for (const [key, value] of Object.entries(input)) {
      const lookup = LOOKUPS[key];
      if (lookup && value) callAction(lookup[0], { [lookup[1]]: value }).then(r => {
        if (alive) setNames(n => ({ ...n, [key]: [r.ref ?? r.name, r.customer?.name].filter(Boolean).join(" · ") }));
      }).catch(() => {});
    }
    if (input.staffIds || input.staffId) callAction("staff.list", {}).then(rows => {
      const ids = input.staffIds ?? [input.staffId];
      if (alive) setNames(n => ({ ...n, [input.staffIds ? "staffIds" : "staffId"]: ids.map((id: string) => rows.find((s: any) => s.id === id)?.name ?? "Unavailable cleaner").join(", ") || "Unassigned" }));
    }).catch(() => {});
    return () => { alive = false; };
  }, [input]);
  const label = (key: string) => ({ staffIds: "Cleaners", startAt: "Visit time", scheduledAt: "Visit time", wholeSeries: "All future visits", amountCents: "Amount" }[key] ?? key.replace(/Cents$|Ids?$|At$/g, "").replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()));
  const value = (key: string, v: any): string => {
    if (names[key]) return names[key];
    if (/Cents$/.test(key) && typeof v === "number") return fmt(v);
    if (/At$/.test(key) && typeof v === "string" && Number.isFinite(Date.parse(v))) return new Date(v).toLocaleString("en-MY", { timeZone: "Asia/Kuching" }) + " (MYT)";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (/Ids?$/.test(key)) return "Record details unavailable — check details below";
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  };
  return <div className="mt-2 text-xs text-ink-700">
    <p className="mb-2 font-semibold">{action.split(".").map(s => s.replace(/([A-Z])/g, " $1")).join(" · ")}</p>
    <dl className="space-y-2 rounded-lg bg-white/80 p-3">{Object.entries(input).filter(([, v]) => v != null).map(([k, v]) => <div key={k}><dt className="text-ink-400">{label(k)}</dt><dd className="break-words font-medium">{value(k, v)}</dd></div>)}</dl>
    <details className="mt-2"><summary className="cursor-pointer">Technical details</summary><pre className="max-h-40 overflow-auto text-[10px]">{JSON.stringify(input, null, 2)}</pre></details>
  </div>;
}
