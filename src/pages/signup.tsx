"use client";

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { Alert, Button, Input } from "../components/ui";
import { AuthLayout } from "../components/auth-layout";

export function SignUpPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await signUp(name, email, password);
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Start bringing your people, plans and events together."
      footer={<>Already have an account? <Link to="/login" className="font-semibold text-accent transition-colors hover:text-accent-strong">Sign in</Link></>}
    >
      {error && <Alert tone="danger" className="mb-5">{error}</Alert>}
      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          id="name"
          label="Full name"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Jane Doe"
          autoComplete="name"
          required
          minLength={2}
        />
        <Input
          id="email"
          label="Email address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.currentTarget.value)}
          placeholder="you@example.com"
          autoComplete="email"
          required
        />
        <Input
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          placeholder="••••••••"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={256}
        />
        <Input
          id="confirmPassword"
          label="Confirm password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.currentTarget.value)}
          placeholder="••••••••"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={256}
        />
        <Button type="submit" className="mt-1 w-full" disabled={loading}>
          {loading ? "Creating account..." : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
