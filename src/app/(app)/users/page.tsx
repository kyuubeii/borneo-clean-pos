"use client";
import { useState } from "react";
import { useT } from "@/components/I18nProvider";
import { useAction, Empty, Modal, Field, callAction, toast } from "@/components/ui";
import { useCurrentUser } from "@/components/UserProvider";
import PageHeader from "@/components/PageHeader";
import { fmtDate } from "@/lib/dates";

const ROLES: Record<string, { label: string; desc: string; tone: string }> = {
  OWNER: { label: "Owner", desc: "Full access including users and settings", tone: "bg-purple-100 text-purple-700" },
  ADMIN: { label: "Admin", desc: "Operations, scheduling and finances", tone: "bg-brand-100 text-brand-700" },
  STAFF: { label: "Cleaner", desc: "Own jobs, check-in/out, expenses", tone: "bg-ink-100 text-ink-600" },
};

export default function Users() {
  const t = useT();
  const me = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [doomed, setDoomed] = useState<any>(null);
  const { data, loading, refresh } = useAction<any[]>("users.list", {});
  // Deleting the last active owner would leave nobody able to manage users.
  const activeOwners = (data ?? []).filter((u) => u.role === "OWNER" && u.active).length;

  async function change(u: any, patch: any) {
    try { await callAction("users.update", { userId: u.id, ...patch }); toast("User updated"); refresh(); }
    catch (e: any) { toast(e.message, "err"); }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title={t("nav.users")} subtitle="Accounts, roles and permissions"
        actions={<button onClick={() => setOpen(true)} className="btn-primary btn-sm">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 5v14M5 12h14"/></svg>
          {t("common.new")}</button>} />

      <div className="card mb-4 card-pad">
        <p className="section-title mb-2">Roles</p>
        <div className="grid gap-2 sm:grid-cols-3">
          {Object.entries(ROLES).map(([k, r]) => (
            <div key={k} className="rounded-lg border border-ink-100 p-2.5">
              <span className={`badge ${r.tone}`}>{r.label}</span>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-500">{r.desc}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? <p className="p-4 text-sm text-ink-400">{t("common.loading")}</p>
        : !data?.length ? <Empty text={t("common.empty")} />
        : <div className="overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead className="border-b border-ink-100 bg-ink-50/50">
                <tr><th className="th">{t("common.name")}</th><th className="th">{t("common.email")}</th>
                  <th className="th">Role</th><th className="th">Since</th><th className="th text-right">{t("common.status")}</th><th className="th" /></tr>
              </thead>
              <tbody className="divide-y divide-ink-50">
                {data.map((u) => (
                  <tr key={u.id} className={u.active ? "" : "opacity-50"}>
                    <td className="td font-medium text-ink-900">{u.name}
                      {u.staffName && <span className="ml-1.5 badge bg-ink-100 text-ink-500">cleaner</span>}</td>
                    <td className="td text-ink-500">{u.email}</td>
                    <td className="td">
                      <select className="input w-auto py-1 text-xs" value={u.role} onChange={(e) => change(u, { role: e.target.value })}>
                        {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
                      </select>
                    </td>
                    <td className="td whitespace-nowrap text-ink-400">{fmtDate(new Date(u.createdAt))}</td>
                    <td className="td text-right">
                      <button onClick={() => change(u, { active: !u.active })}
                        className={`btn-sm ${u.active ? "btn-ghost text-ink-500" : "btn-outline text-emerald-600"}`}>
                        {u.active ? "Deactivate" : "Reactivate"}</button>
                    </td>
                    <td className="td text-right">
                      <button onClick={() => setDoomed(u)} disabled={u.id === me.id || (u.role === "OWNER" && u.active && activeOwners <= 1)}
                        title={u.id === me.id ? "You cannot delete your own account"
                          : u.role === "OWNER" && u.active && activeOwners <= 1 ? "The last active owner cannot be deleted"
                          : "Permanently delete this account"}
                        className="btn-sm btn-ghost text-rose-600 disabled:cursor-not-allowed disabled:text-ink-300">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
      </div>

      <NewUser open={open} onClose={() => setOpen(false)} onDone={refresh} />
      <DeleteUser user={doomed} onClose={() => setDoomed(null)} onDone={refresh} />
    </div>
  );
}

function NewUser({ open, onClose, onDone }: any) {
  const t = useT();
  const staff = useAction<any[]>("staff.list", {});
  const [f, setF] = useState<any>({ name: "", email: "", password: "", role: "STAFF", staffId: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.value });

  async function go() {
    setBusy(true);
    try {
      await callAction("users.create", { name: f.name, email: f.email, password: f.password, role: f.role, staffId: f.staffId || undefined });
      toast("User created"); onDone(); onClose();
      setF({ name: "", email: "", password: "", role: "STAFF", staffId: "" });
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="New user">
      <div className="space-y-3">
        <Field label={t("common.name")}><input className="input" value={f.name} onChange={set("name")} /></Field>
        <Field label={t("common.email")}><input className="input" type="email" value={f.email} onChange={set("email")} /></Field>
        <Field label={t("auth.password")} hint="At least 6 characters."><input className="input" type="password" value={f.password} onChange={set("password")} /></Field>
        <Field label="Role">
          <select className="input" value={f.role} onChange={set("role")}>
            {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.label} — {r.desc}</option>)}
          </select>
        </Field>
        {f.role === "STAFF" && (
          <Field label={`Link to cleaner profile (${t("common.optional")})`}>
            <select className="input" value={f.staffId} onChange={set("staffId")}>
              <option value="">— none —</option>
              {(staff.data ?? []).filter((s) => !s.userId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        )}
        <div className="flex justify-end gap-2"><button onClick={onClose} className="btn-outline">{t("common.cancel")}</button>
          <button onClick={go} disabled={busy} className="btn-primary">{t("common.create")}</button></div>
      </div>
    </Modal>
  );
}

/** Permanent account deletion. The email must be typed out to arm the button. */
function DeleteUser({ user, onClose, onDone }: any) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const armed = !!user && typed.trim().toLowerCase() === user.email.toLowerCase();

  function close() { setTyped(""); onClose(); }

  async function go() {
    setBusy(true);
    try {
      const r = await callAction("users.delete", { userId: user.id });
      toast(r.unlinkedStaff ? `${r.name} deleted \u2014 cleaner profile "${r.unlinkedStaff}" kept` : `${r.name} deleted`);
      onDone(); close();
    } catch (e: any) { toast(e.message, "err"); } finally { setBusy(false); }
  }

  return (
    <Modal open={!!user} onClose={close} title="Delete user permanently">
      {user && (
        <div className="space-y-3">
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
            <p className="text-sm font-medium text-rose-800">{user.name} · {user.email}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-rose-700">
              This removes the account and its login for good. It cannot be undone.
              {user.staffName ? ` The cleaner profile "${user.staffName}" and its job history are kept \u2014 only the login is removed.` : ""}
              {" Their audit trail stays under their name."}
            </p>
          </div>
          <p className="text-[11px] leading-relaxed text-ink-500">
            To block sign-in without losing the account, close this and use <strong>Deactivate</strong> instead.
          </p>
          <Field label="Type the email address to confirm" hint={user.email}>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={user.email} autoComplete="off" />
          </Field>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="btn-outline">{t("common.cancel")}</button>
            <button onClick={go} disabled={!armed || busy}
              className="btn-sm rounded-lg bg-rose-600 px-3 py-2 font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:bg-ink-200">
              {busy ? "Deleting\u2026" : "Delete permanently"}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
