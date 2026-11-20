"use client";

import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../App";
import { api } from "../lib/api";
import type { UserRecord } from "../types";
import { Alert, Avatar, Badge, Button, Input, PageHeader, Section, Skeleton } from "../components/ui";
import { UsersIcon } from "../components/icons";

function roleTone(role: string) {
  if (role === "owner") return "warning" as const;
  if (role === "admin") return "info" as const;
  return "neutral" as const;
}

export function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function loadUsers() {
    if (!user) return;
    const result = await api.listUsers(user.id);
    if (result.success && result.data) {
      setUsers(result.data);
      setError("");
    } else {
      setError(result.error || "Could not load workspace users. Check the website pairing and connection.");
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!user || (user.workspaceRole !== "owner" && user.workspaceRole !== "admin")) {
      setLoading(false);
      return;
    }
    void loadUsers();
  }, [user]);

  async function mutate(action: string, input: { targetUserId?: string; name?: string; email?: string; password?: string; role?: string }, message: string): Promise<boolean> {
    if (!user) return false;
    setBusy(true); setError(""); setNotice("");
    const result = await api.manageWorkspaceUser(user.id, action, input);
    if (!result.success) setError(result.error || "The website could not complete that user action.");
    else { setNotice(message); await loadUsers(); }
    setBusy(false);
    return result.success;
  }

  async function createUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await mutate("create", { name, email, password }, `Created the account for ${name.trim()}.`)) { setName(""); setEmail(""); setPassword(""); }
  }

  async function editUser(record: UserRecord) {
    const nextName = window.prompt("Name", record.name);
    if (nextName === null) return;
    const nextEmail = window.prompt("Email address", record.email);
    if (nextEmail === null) return;
    await mutate("update", { targetUserId: record.id, name: nextName, email: nextEmail }, `Updated ${record.name}'s account.`);
  }

  async function resetPassword(record: UserRecord) {
    const nextPassword = window.prompt(`Enter a new password for ${record.name} (at least 6 characters).`);
    if (nextPassword === null) return;
    await mutate("reset-password", { targetUserId: record.id, password: nextPassword }, `Password reset for ${record.name}.`);
  }

  async function deleteUser(record: UserRecord) {
    if (!window.confirm(`Permanently delete ${record.name} (${record.email})? This cannot be undone.`)) return;
    await mutate("delete", { targetUserId: record.id }, `Deleted ${record.name}'s account.`);
  }

  if (loading) {
    return <div className="space-y-6"><div className="space-y-3"><Skeleton className="h-3 w-16" /><Skeleton className="h-7 w-40" /></div><Skeleton className="h-[300px] rounded-2xl" /></div>;
  }

  if (!user || (user.workspaceRole !== "owner" && user.workspaceRole !== "admin")) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Workspace" title="Users" description="Manage accounts and roles for this workspace." actions={<Badge tone="neutral">{users.length} {users.length === 1 ? "member" : "members"}</Badge>} />
      {error && <Alert tone="danger">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <Alert tone="info">User changes are applied to the paired website workspace. The desktop must be paired and online.</Alert>

      <Section title="Create a workspace user" icon={<UsersIcon className="h-4 w-4" />}>
        <form onSubmit={(event) => void createUser(event)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input id="workspace-user-name" label="Name" value={name} onChange={(event) => setName(event.currentTarget.value)} required />
          <Input id="workspace-user-email" label="Email" type="email" value={email} onChange={(event) => setEmail(event.currentTarget.value)} required />
          <Input id="workspace-user-password" label="Initial password" type="password" minLength={6} value={password} onChange={(event) => setPassword(event.currentTarget.value)} required />
          <div className="flex items-end"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Create user"}</Button></div>
        </form>
      </Section>

      <Section bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[12.5px]">
            <thead><tr className="sticky top-0 z-10 border-b border-line-soft bg-raised">
              <th className="px-5 py-3.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-muted">Member</th>
              <th className="px-5 py-3.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-muted">Email</th>
              <th className="px-5 py-3.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-muted">Workspace role</th>
              <th className="px-5 py-3.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-muted">Joined</th>
              <th className="px-5 py-3.5 font-mono text-[9px] font-semibold uppercase tracking-widest text-muted">Actions</th>
            </tr></thead>
            <tbody className="divide-y divide-line-soft">
              {users.length === 0 ? <tr><td colSpan={5} className="px-5 py-12 text-center text-muted">No users found.</td></tr> : users.map((record) => (
                <tr key={record.id} className="group transition-colors hover:bg-raised">
                  <td className="px-5 py-3.5"><div className="flex items-center gap-3"><Avatar name={record.name} src={record.avatarUrl} size="sm" /><span className="font-semibold text-ink">{record.name}{record.id === user.id ? " (you)" : ""}</span></div></td>
                  <td className="px-5 py-3.5 text-muted"><span className="block max-w-[220px] truncate">{record.email}</span></td>
                  <td className="px-5 py-3.5">
                    {user.workspaceRole === "owner" && record.id !== user.id ? <select aria-label={`Workspace role for ${record.name}`} value={record.workspaceRole} disabled={busy} onChange={(event) => void mutate("set-role", { targetUserId: record.id, role: event.target.value }, `Updated ${record.name}'s workspace role.`)} className="h-8 rounded-lg border border-line bg-panel px-2 text-[11px]"><option value="member">Member</option><option value="admin">Admin</option><option value="owner">Owner</option></select> : <Badge tone={roleTone(record.workspaceRole)}>{record.workspaceRole}</Badge>}
                  </td>
                  <td className="px-5 py-3.5 text-muted tabular-nums">{new Date(record.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</td>
                  <td className="px-5 py-3.5"><div className="flex flex-wrap gap-1.5"><Button size="sm" variant="secondary" disabled={busy} onClick={() => void editUser(record)}>Edit</Button><Button size="sm" variant="secondary" disabled={busy} onClick={() => void resetPassword(record)}>Reset password</Button>{record.id !== user.id && <Button size="sm" variant="danger" disabled={busy} onClick={() => void deleteUser(record)}>Delete</Button>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
