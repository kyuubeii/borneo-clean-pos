"use client";
import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { DndContext, useDraggable, useDroppable, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useT } from "@/components/I18nProvider";
import { useAction, callAction, toast, Badge, Empty, Modal, LoadError } from "@/components/ui";
import PageHeader from "@/components/PageHeader";
import BookingForm from "@/components/BookingForm";
import { useCurrentUser } from "@/components/UserProvider";
import { startOfWeek, startOfMonth, addDays, addMonths, fmtTime, fmtDate, sameDay, minsToLabel, isoDate } from "@/lib/dates";

type View = "day" | "week" | "month";
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export default function Calendar() {
  const t = useT();
  const [view, setView] = useState<View>("week");
  useEffect(() => { if (window.matchMedia("(max-width: 639px)").matches) setView("day"); }, []);
  const [anchor, setAnchor] = useState(new Date());
  const [move, setMove] = useState<any>(null);
  const [moving, setMoving] = useState(false);
  const [more, setMore] = useState<Date | null>(null);
  const [newAt, setNewAt] = useState<Date | null>(null);

  const { from, to } = useMemo(() => {
    if (view === "day") return { from: anchor, to: anchor };
    if (view === "week") { const s = startOfWeek(anchor); return { from: s, to: addDays(s, 6) }; }
    const s = startOfMonth(anchor);
    return { from: startOfWeek(s), to: addDays(startOfWeek(s), 41) };
  }, [view, anchor]);

  const me = useCurrentUser();
  const isStaff = me.role === "STAFF";
  const jobs = useAction<any[]>("jobs.list",
    { from: isoDate(from), to: isoDate(to), limit: 100, ...(isStaff && me.staffId ? { staffId: me.staffId } : {}) }, [view]);
  const staff = useAction<any[]>("staff.list", {});
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  async function onDragEnd(e: DragEndEvent) {
    if (isStaff) return; // Cleaners cannot reassign or reschedule.
    const jobId = String(e.active.data.current?.jobId);
    const target = e.over?.id ? String(e.over.id) : null;
    if (!target) return;
    const job = jobs.data?.find((j) => j.id === jobId);
    if (!job) return;
    const cell = JSON.parse(target);
    const d = new Date(cell.date);
    const cur = new Date(job.scheduledAt);
    d.setHours(cur.getHours(), cur.getMinutes(), 0, 0);
    const team = cell.staffId === "none" ? [] : job.staffIds.includes(cell.staffId) ? job.staffIds : job.staffIds.length > 1 ? [...job.staffIds, cell.staffId] : [cell.staffId];
    setMove({ job, when: d, staffIds: team });
  }
  async function saveMove() {
    setMoving(true);
    try {
      await callAction("jobs.move", { jobId: move.job.id, scheduledAt: move.when.toISOString(), staffIds: move.staffIds });
      toast("Schedule updated"); setMove(null); jobs.refresh();
    } catch (e: any) { toast(e.message, "err"); } finally { setMoving(false); }
  }

  const shift = (n: number) => setAnchor(view === "month" ? addMonths(anchor, n) : addDays(anchor, view === "week" ? 7 * n : n));
  const title = view === "month" ? anchor.toLocaleDateString("en-MY", { month: "long", year: "numeric" })
    : view === "week" ? `${fmtDate(startOfWeek(anchor))} — ${fmtDate(addDays(startOfWeek(anchor), 6))}`
    : fmtDate(anchor);

  return (
    <div>
      <PageHeader title={t("nav.calendar")} subtitle={title} actions={
        <>
          <div className="inline-flex rounded-lg border border-ink-200 bg-white p-0.5 text-xs font-medium">
            {(["day","week","month"] as View[]).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`rounded-md px-3 py-1.5 transition ${view === v ? "bg-brand-600 text-white" : "text-ink-500 hover:text-ink-800"}`}>
                {t(`cal.${v}`)}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-ink-200 bg-white">
            <button onClick={() => shift(-1)} className="px-2.5 py-1.5 text-ink-500 hover:bg-ink-50">‹</button>
            <button onClick={() => setAnchor(new Date())} className="border-x border-ink-200 px-3 py-1.5 text-xs font-medium text-ink-600 hover:bg-ink-50">{t("common.today")}</button>
            <button onClick={() => shift(1)} className="px-2.5 py-1.5 text-ink-500 hover:bg-ink-50">›</button>
          </div>
          {!isStaff && (
            <button onClick={() => setNewAt(anchor)} className="btn-primary btn-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
              {t("common.new")}
            </button>
          )}
        </>} />

      <LoadError error={jobs.error || staff.error} onRetry={() => { jobs.refresh(); staff.refresh(); }} />
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        {jobs.loading ? <p className="text-sm text-ink-400">{t("common.loading")}</p>
        : view === "month" ? <MonthView from={from} anchor={anchor} jobs={jobs.data ?? []} onMore={setMore} onPick={isStaff ? () => {} : setNewAt} />
        : <StaffBoard days={view === "day" ? [anchor] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))}
            jobs={jobs.data ?? []} staff={isStaff ? (staff.data ?? []).filter((s: any) => s.id === me.staffId) : (staff.data ?? [])}
            view={view} readOnly={isStaff} onPick={setNewAt} />}
      </DndContext>

      <Modal open={!!move} onClose={() => { if (!moving) setMove(null); }} title="Review schedule change">
        {move && <div className="space-y-3">
          <p className="font-medium">{move.job.ref} · {move.job.customer}</p>
          <p className="text-sm">{fmtDate(new Date(move.job.scheduledAt))} → {fmtDate(move.when)} · {fmtTime(move.when)}</p>
          <p className="text-xs text-ink-500">Choose the complete team. Existing team members are kept for multi-cleaner jobs.</p>
          {(staff.data ?? []).map(s => <label key={s.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={move.staffIds.includes(s.id)} onChange={e => setMove({ ...move, staffIds: e.target.checked ? [...move.staffIds, s.id] : move.staffIds.filter((id: string) => id !== s.id) })} />{s.name}</label>)}
          <button disabled={moving} className="btn-primary" onClick={saveMove}>{moving ? "Saving…" : "Apply schedule change"}</button>
        </div>}
      </Modal>
      <Modal open={!!more} onClose={() => setMore(null)} title={more ? fmtDate(more) : "Jobs"}>
        {(jobs.data ?? []).filter(j => more && sameDay(new Date(j.scheduledAt), more)).map(j => <Link key={j.id} href={`/jobs/${j.id}`} className="block rounded-lg p-3 hover:bg-ink-50">{fmtTime(new Date(j.scheduledAt))} · {j.customer} · {j.ref}</Link>)}
      </Modal>
      <BookingForm open={!!newAt} onClose={() => setNewAt(null)} onDone={jobs.refresh} presetStart={newAt ?? undefined} />
    </div>
  );
}

/* ----------------------- Week/day: cleaners as columns --------------------- */
function StaffBoard({ days, jobs, staff, view, onPick, readOnly }: any) {
  const t = useT();
  const rows = readOnly ? staff : [...staff, { id: "none", name: t("cal.unassigned"), colour: "#cbd5e1" }];
  return (
    <div className="space-y-2">
      {!readOnly && <p className="text-[11px] text-ink-400">{t("cal.dragHint")}</p>}
      <div className="card overflow-x-auto">
        <div className={days.length === 1 ? "min-w-0" : "min-w-[840px]"}>
          <div className="grid border-b border-ink-100 bg-ink-50/50" style={{ gridTemplateColumns: `160px repeat(${days.length}, minmax(0,1fr))` }}>
            <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink-400">{t("nav.staff")}</div>
            {days.map((d: Date) => (
              <div key={d.toISOString()} className={`px-2 py-2 text-center text-[11px] font-semibold ${sameDay(d, new Date()) ? "text-brand-600" : "text-ink-500"}`}>
                {DOW[d.getDay()]} <span className="text-ink-400">{d.getDate()}</span>
              </div>
            ))}
          </div>
          {rows.map((s: any) => (
            <StaffRow key={s.id} staff={s} days={days} jobs={jobs} onPick={readOnly ? () => {} : onPick} readOnly={readOnly} />
          ))}
        </div>
      </div>
    </div>
  );
}

function StaffRow({ staff, days, jobs, onPick, readOnly }: any) {
  return (
    <div className="grid border-b border-ink-50"
      style={{ gridTemplateColumns: `160px repeat(${days.length}, minmax(0,1fr))` }}>
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: staff.colour }} />
        <span className="truncate text-xs font-medium text-ink-700">{staff.name}</span>
      </div>
      {days.map((d: Date) => {
        const cell = jobs.filter((j: any) => {
          const mine = staff.id === "none" ? j.cleaners.length === 0 : j.staffIds.includes(staff.id);
          return mine && sameDay(new Date(j.scheduledAt), d);
        });
        return (
          <DayCell key={d.toISOString()} date={d} staffId={staff.id} readOnly={readOnly} onPick={onPick}>
            {cell.map((j: any) => <JobChip key={j.id} job={j} staffId={staff.id} readOnly={readOnly} />)}
          </DayCell>
        );
      })}
    </div>
  );
}

function DayCell({ date, children, onPick, staffId, readOnly }: any) {
  const { setNodeRef, isOver } = useDroppable({ id: JSON.stringify({ date: date.toISOString(), staffId }), disabled: readOnly });
  return (
    <div ref={setNodeRef} onDoubleClick={() => onPick(date)}
      className={`min-h-[62px] space-y-1 border-l border-ink-50 p-1 transition ${isOver ? "bg-brand-100/50" : ""}`}>
      {children}
    </div>
  );
}

function JobChip({ job, staffId, readOnly }: { job: any; staffId: string; readOnly: boolean }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `${job.id}:${staffId}`, data: { jobId: job.id }, disabled: readOnly || ["COMPLETED", "CANCELLED"].includes(job.status) });
  const tone = job.status === "COMPLETED" ? "bg-emerald-50 border-emerald-200 text-emerald-800"
    : job.status === "CANCELLED" ? "bg-red-50 border-red-200 text-red-500 line-through"
    : job.status === "IN_PROGRESS" ? "bg-blue-50 border-blue-200 text-blue-800"
    : "bg-white border-ink-200 text-ink-700";
  return (
    <div ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 } : undefined}
      className={`cursor-grab rounded-md border px-1.5 py-1 text-[10px] leading-tight shadow-sm active:cursor-grabbing ${tone} ${isDragging ? "opacity-70 shadow-lg" : ""}`}>
      <Link href={`/jobs/${job.id}`} className="block"><p className="font-semibold tabular-nums">{fmtTime(new Date(job.scheduledAt))}</p><p className="truncate">{job.customer}</p></Link>
      {!readOnly && !["COMPLETED", "CANCELLED"].includes(job.status) && <button {...listeners} {...attributes} aria-label={`Move ${job.ref}`} className="mt-1 touch-none cursor-grab text-ink-500">⠿ Move</button>}
    </div>
  );
}

/* ------------------------------- Month view -------------------------------- */
function MonthView({ from, anchor, jobs, onPick, onMore }: any) {
  const days = Array.from({ length: 42 }, (_, i) => addDays(from, i));
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-ink-100 bg-ink-50/50">
        {DOW.map((d) => <div key={d} className="px-2 py-2 text-center text-[11px] font-semibold text-ink-400">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const inMonth = d.getMonth() === anchor.getMonth();
          const today = sameDay(d, new Date());
          const cell = jobs.filter((j: any) => sameDay(new Date(j.scheduledAt), d));
          const revenue = cell.reduce((a: number, j: any) => a + j.revenueCents, 0);
          return (
            <div key={d.toISOString()} onDoubleClick={() => onPick(d)}
              className={`min-h-[92px] border-b border-l border-ink-50 p-1.5 ${inMonth ? "" : "bg-ink-50/40"}`}>
              <div className="mb-1 flex items-center justify-between">
                <span className={`text-[11px] font-medium ${today ? "flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-white" : inMonth ? "text-ink-600" : "text-ink-300"}`}>{d.getDate()}</span>
                {revenue > 0 && <span className="text-[9px] tabular-nums text-ink-400">{(revenue / 100).toFixed(0)}</span>}
              </div>
              <div className="space-y-0.5">
                {cell.slice(0, 3).map((j: any) => (
                  <Link key={j.id} href={`/jobs/${j.id}`}
                    className="block truncate rounded px-1 py-0.5 text-[10px] leading-tight text-ink-600 hover:bg-ink-100">
                    <span className="font-medium tabular-nums">{fmtTime(new Date(j.scheduledAt)).replace(":00", "")}</span> {j.customer}
                  </Link>
                ))}
                {cell.length > 3 && <button onClick={() => onMore(d)} className="px-1 text-xs text-brand-600">+{cell.length - 3} more</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
