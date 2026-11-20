import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Link } from "react-router-dom";
import { AuthLayout } from "../components/auth-layout";
import { Alert, Button, Input } from "../components/ui";
import { api } from "../lib/api";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [devLink, setDevLink] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setDevLink("");
    setLoading(true);
    try {
      const result = await api.requestPasswordReset(email);
      if (!result.success || !result.data || result.data.error) {
        setError(result.data?.error || result.error || "Could not request a password reset.");
        return;
      }
      setSuccess(result.data.success ?? "If an account exists for that email, a reset link is on its way.");
      setDevLink(result.data.devLink ?? "");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reach the website.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter the email address tied to your account and we'll send you a recovery link that works for 60 minutes."
      footer={<>Remember your password? <Link to="/login" className="font-semibold text-accent transition-colors hover:text-accent-strong">Back to sign in</Link></>}
    >
      {success ? (
        <div className="space-y-4">
          <Alert tone="success">{success}</Alert>
          {devLink && (
            <div className="rounded-xl border border-dashed border-line bg-sunken p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted">Development link</p>
              <button type="button" onClick={() => void openUrl(devLink)} className="mt-2 block break-all text-left text-[12px] font-semibold text-accent hover:underline">{devLink}</button>
            </div>
          )}
          <Link to="/login" className="flex w-full items-center justify-center rounded-xl bg-accent px-4 py-2.5 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-accent/90">Back to sign in</Link>
          <p className="text-center text-[12px] text-muted">Didn't get an email? Try again in a minute — links expire after 60 minutes.</p>
          <button type="button" onClick={() => setSuccess("")} className="block w-full text-center text-[12px] font-semibold text-accent hover:underline">Request another link</button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input id="email" label="Email address" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" className="w-full" disabled={loading}>{loading ? "Sending…" : "Send recovery link"}</Button>
        </form>
      )}
    </AuthLayout>
  );
}
