"use client";

import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import type { SyncConfigInfo } from "../types";
import { BellIcon, MenuIcon } from "./icons";
import { IconButton } from "./ui";
import { ProfileDropdown } from "./profile-dropdown";

function LiveSyncPill() {
  const [state, setState] = useState<SyncConfigInfo | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = () => api.syncGetConfig().then((result) => {
      if (alive && result.success && result.data) {
        setState(result.data);
        if (result.data.connected) setPairingError(null);
      }
    });
    poll();
    const timer = setInterval(poll, 5000);
    const unlistenSync = listen<number>("sync-applied", poll);
    const unlistenError = listen<string>("sync-pairing-error", (event) => setPairingError(event.payload));
    const unlistenSuccess = listen<SyncConfigInfo>("sync-pairing-success", () => { setPairingError(null); poll(); });
    return () => {
      alive = false;
      clearInterval(timer);
      unlistenSync.then((fn) => fn());
      unlistenError.then((fn) => fn());
      unlistenSuccess.then((fn) => fn());
    };
  }, []);

  const connected = Boolean(state?.connected);
  const healthy = connected && !state?.lastError;
  const label = healthy ? "Sync on" : pairingError || state?.lastError ? "Sync issue" : "Offline";
  const title = healthy
    ? `Synced with ${state?.websiteUrl} automatically${state?.lastSyncAt ? ` · last sync ${new Date(state.lastSyncAt).toLocaleTimeString()}` : ""}`
    : pairingError ?? state?.lastError ?? "Sign in with your website account to enable automatic sync.";

  return <div title={title} role="status" className={`hidden items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold sm:flex ${healthy ? "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200" : "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200"}`}><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${healthy ? "animate-pulse bg-emerald-500" : "bg-amber-500"}`} />{label}</div>;
}

const sectionLabels: { match: string; label: string }[] = [
  { match: "/dashboard", label: "Overview" },
  { match: "/my-events", label: "My events" },
  { match: "/search", label: "Search" },
  { match: "/events/new", label: "Create event" },
  { match: "/events", label: "Event details" },
  { match: "/calendar", label: "Calendar" },
  { match: "/invitations", label: "Invitations" },
  { match: "/my-activity", label: "Activity" },
  { match: "/users", label: "People" },
  { match: "/profile", label: "Profile" },
  { match: "/settings", label: "Settings" },
  { match: "/help", label: "Help & support" },
  { match: "/templates", label: "Templates" },
];

function NotificationLink({ userId, active }: { userId?: string; active: boolean }) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    const refresh = () => api.getUnreadNotificationCount(userId).then((result) => {
      if (alive && result.success) setUnread(result.data ?? 0);
    });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    const unlisten = listen("sync-applied", () => void refresh());
    return () => { alive = false; window.clearInterval(timer); unlisten.then((stop) => stop()); };
  }, [userId]);
  return <Link to="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} title={unread ? `${unread} unread notifications` : "Notifications"} className={`relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7468e8]/40 ${active ? "bg-[#f0efff] text-[#6558d3]" : "text-[#737a91] hover:bg-[#f3f4f9] hover:text-[#252941]"}`}><BellIcon className="h-[17px] w-[17px]" />{unread > 0 && <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />}</Link>;
}

export function Topbar({
  user,
  onSignOut,
  onMenuToggle,
}: {
  user: { id: string; name: string; email: string; workspaceRole?: string } | null;
  onSignOut: () => Promise<void>;
  onMenuToggle: () => void;
}) {
  const { pathname } = useLocation();
  const current = sectionLabels.find(({ match }) => pathname.startsWith(match))?.label ?? "Workspace";

  return <header className="sticky top-0 z-30 flex h-[68px] shrink-0 items-center gap-3 border-b border-[#e7e9f2] bg-white/90 px-4 backdrop-blur-xl sm:px-7 lg:px-10">
    <IconButton label="Toggle navigation" onClick={onMenuToggle} className="lg:hidden"><MenuIcon className="h-4 w-4" /></IconButton>
    <nav aria-label="Breadcrumb" className="min-w-0 flex-1"><ol className="flex min-w-0 items-center gap-2 text-[12px]"><li className="hidden font-medium text-[#9298ac] sm:block">EventPulse</li><li aria-hidden="true" className="hidden text-[#c4c8d5] sm:block">/</li><li className="truncate font-semibold text-[#252941]">{current}</li></ol></nav>
    <div className="flex shrink-0 items-center gap-2.5 sm:gap-3"><LiveSyncPill /><NotificationLink userId={user?.id} active={pathname.startsWith("/notifications")} /><span aria-hidden="true" className="hidden h-7 w-px bg-[#e7e9f2] sm:block" /><ProfileDropdown user={user} onSignOut={onSignOut} appearance="light" placement="bottom" compact={false} /></div>
  </header>;
}
