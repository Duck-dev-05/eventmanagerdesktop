import { useState, type FormEvent } from "react";
import { api } from "../lib/api";
import { Alert, Button, Section } from "./ui";

export function InvitationComposer({ userId }: { userId: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    setInviteUrl(null);
    try {
      const result = await api.sendInvitation(userId, email);
      if (result.success && result.data) {
        setMessage(result.data.message);
        setInviteUrl(result.data.inviteUrl);
        setEmail("");
      } else {
        setError(result.error || "Could not send the invitation.");
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(`Copy this invitation link: ${inviteUrl}`);
    }
  }

  return (
    <Section title="Invite people" description="Invite someone to join EventPulse. They can be added to an event later.">
      <form onSubmit={(event) => void send(event)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-[11.5px] font-medium text-muted">
          Email address
          <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@example.com" className="mt-1.5 h-10 w-full rounded-xl border border-line bg-panel px-3 text-[12.5px] text-ink outline-none focus:border-accent" />
        </label>
        <Button type="submit" disabled={busy}>{busy ? "Sending…" : "Send invitation"}</Button>
      </form>
      {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
      {message && <div role="status" className="mt-3 rounded-xl border border-success-line bg-success-soft p-3 text-[12px] text-success">{message}{inviteUrl && <div><button type="button" onClick={() => void copyLink()} className="mt-2 font-semibold underline underline-offset-2">{copied ? "Copied" : "Copy invitation link"}</button></div>}</div>}
    </Section>
  );
}
