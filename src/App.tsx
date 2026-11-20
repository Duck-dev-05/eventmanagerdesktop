"use client";

import { useState, useEffect, createContext, useContext, useCallback, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { emit, listen } from "@tauri-apps/api/event";
import { api } from "./lib/api";
import type { SessionUser } from "./types";
import { Layout } from "./components/layout";
import { DesktopUpdateNotice } from "./components/desktop-update-notice";
import { LoginPage } from "./pages/login";
import { ForgotPasswordPage } from "./pages/forgot-password";
import { SignUpPage } from "./pages/signup";
import { DashboardPage } from "./pages/dashboard";
import { MyEventsPage } from "./pages/my-events";
import { CreateEventPage } from "./pages/create-event";
import { EventDetailPage } from "./pages/event-detail";
import { EventEditPage } from "./pages/event-edit";
import { SettingsPage } from "./pages/settings";
import { ProfilePage } from "./pages/profile";
import { NotificationsPage } from "./pages/notifications";
import { UsersPage } from "./pages/users";
import { TemplatesPage } from "./pages/templates";
import { CalendarPage } from "./pages/calendar";
import { InvitationsPage } from "./pages/invitations";
import { MyActivityPage } from "./pages/my-activity";
import { HelpPage } from "./pages/help";
import { SearchPage } from "./pages/search";
import { PrintEventPage } from "./pages/print-event";

const AuthContext = createContext<{
  user: SessionUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (name: string, email: string, password: string) => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
}>({
  user: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  signInWithGoogle: async () => {},
  signOut: async () => {},
  refreshUser: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

function StartupScreen() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f6fb] p-6 text-[#20243b]">
      <section className="flex flex-col items-center text-center" role="status" aria-live="polite">
        <img src="/eventpulse-icon.png" alt="" className="h-[76px] w-[76px] rounded-[22px] shadow-[0_16px_36px_-18px_rgba(39,37,93,0.45)]" />
        <h1 className="mt-5 text-[18px] font-semibold tracking-tight">EventPulse</h1>
        <p className="mt-1 text-[12px] text-[#7b8197]">Getting your workspace ready…</p>
        <span aria-hidden="true" className="mt-5 h-1 w-24 overflow-hidden rounded-full bg-[#e8e6fa]">
          <span className="block h-full w-1/2 animate-pulse rounded-full bg-[#7468e8]" />
        </span>
      </section>
    </main>
  );
}

function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState<string | null>(null);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.signIn(email, password);
    if (result.success && result.data) {
      setUser(result.data);
      localStorage.setItem("em:user", JSON.stringify(result.data));
      localStorage.setItem("em:userId", result.data.id);
      // Pair in the background. Surface failures in the app UI instead of
      // silently burying them in DevTools.
      void api.syncAutoPair(email, password, result.data.id).then((pairing) => {
        if (pairing.success && pairing.data?.connected) {
          void emit("sync-pairing-success", pairing.data);
        } else {
          void emit("sync-pairing-error", pairing.error ?? "Automatic pairing failed.");
        }
      }).catch((error) => {
        void emit("sync-pairing-error", String(error));
      });
    } else {
      throw new Error(result.error || "Sign in failed");
    }
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const result = await api.signUp(name, email, password);
    if (result.success && result.data) {
      setUser(result.data);
      localStorage.setItem("em:user", JSON.stringify(result.data));
      localStorage.setItem("em:userId", result.data.id);
      // New accounts pair for sync the same way, right after signup.
      void api.syncAutoPair(email, password, result.data.id).then((pairing) => {
        if (pairing.success && pairing.data?.connected) {
          void emit("sync-pairing-success", pairing.data);
        } else {
          void emit("sync-pairing-error", pairing.error ?? "Automatic pairing failed.");
        }
      }).catch((error) => {
        void emit("sync-pairing-error", String(error));
      });
    } else {
      throw new Error(result.error || "Sign up failed");
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const result = await api.googleSignIn();
    if (result.success && result.data) {
      setUser(result.data);
      localStorage.setItem("em:user", JSON.stringify(result.data));
      localStorage.setItem("em:userId", result.data.id);
    } else {
      throw new Error(result.error || "Google sign-in failed");
    }
  }, []);

  const signOut = useCallback(async () => {
    await api.signOut();
    setUser(null);
    localStorage.removeItem("em:user");
    localStorage.removeItem("em:userId");
  }, []);

  const refreshUser = useCallback(async () => {
    const stored = localStorage.getItem("em:user");
    if (stored) {
      try {
        setUser(JSON.parse(stored));
      } catch {
        localStorage.removeItem("em:user");
        localStorage.removeItem("em:userId");
      }
    }
    const userId = localStorage.getItem("em:userId");
    if (userId) {
      try {
        const result = await api.getCurrentUser(userId);
        if (result.success && result.data) {
          setUser(result.data);
          localStorage.setItem("em:user", JSON.stringify(result.data));
        } else {
          localStorage.removeItem("em:user");
          localStorage.removeItem("em:userId");
        }
      } catch {
        // A failed session refresh must never leave the app stuck on a blank screen.
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    api.initDb()
      .then(async (databasePath) => {
        if (!databasePath) throw new Error("Database initialization returned no database path.");
        await refreshUser();
      })
      .catch((error) => {
        if (active) {
          setStartupError(String(error));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [refreshUser]);

  const value = {
    user,
    loading,
    signIn,
    signUp,
    signInWithGoogle,
    signOut,
    refreshUser,
  };

  return (
    <AuthContext.Provider value={value}>
      {startupError ? (
        <main className="flex min-h-screen items-center justify-center bg-canvas p-6 text-ink">
          <section className="max-w-lg rounded-2xl border border-danger-line bg-panel p-6 shadow-card">
            <h1 className="text-lg font-semibold">EventPulse could not start</h1>
            <p className="mt-2 text-sm text-muted">The local database could not be initialized.</p>
            <p className="mt-3 break-words rounded-lg bg-danger-soft p-3 text-xs text-danger">{startupError}</p>
            <button type="button" onClick={() => window.location.reload()} className="mt-4 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white">Restart app</button>
          </section>
        </main>
      ) : loading ? <StartupScreen /> : children}
    </AuthContext.Provider>
  );
}

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

/**
 * The Rust sync thread emits `sync-applied` whenever website changes were
 * written to the local database. Remounting the routes re-fetches whatever
 * page is open so new events show up without a manual reload.
 */
function SyncRefresher({ children }: { children: ReactNode }) {
  const { refreshUser, loading } = useAuth();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<number>("sync-applied", () => {
      setVersion((v) => v + 1);
      refreshUser();
    }).then((fn) => {
      unlisten = fn;
      // Catch up once the database/session bootstrap is complete. Waiting for
      // the listener first ensures an immediate sync result cannot be missed.
      if (!loading) void api.syncNow();
    });
    return () => {
      unlisten?.();
    };
  }, [refreshUser, loading]);

  return <div key={version} className="contents">{children}</div>;
}

function GuestRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  return <>{children}</>;
}

function ProtectedLayout() {
  return (
    <ProtectedRoute>
      <Layout>
        <Outlet />
      </Layout>
    </ProtectedRoute>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SyncRefresher>
        <DesktopUpdateNotice />
        <Routes>
          <Route path="/login" element={<GuestRoute><LoginPage /></GuestRoute>} />
          <Route path="/forgot-password" element={<GuestRoute><ForgotPasswordPage /></GuestRoute>} />
          <Route path="/signup" element={<GuestRoute><SignUpPage /></GuestRoute>} />
          <Route element={<ProtectedLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/my-events" element={<MyEventsPage />} />
            <Route path="/events/new" element={<CreateEventPage />} />
            <Route path="/events/:eventId" element={<EventDetailPage />} />
            <Route path="/events/:eventId/print" element={<PrintEventPage />} />
            <Route path="/events/:eventId/edit" element={<EventEditPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/invitations" element={<InvitationsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/my-activity" element={<MyActivityPage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/templates" element={<TemplatesPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        </SyncRefresher>
      </AuthProvider>
    </BrowserRouter>
  );
}
