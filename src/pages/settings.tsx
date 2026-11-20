"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAuth } from "../App";
import { api } from "../lib/api";
import type { PreferenceRecord } from "../types";
import {
  Alert,
  Button,
  Input,
  PageHeader,
  Section,
  Skeleton,
  Toggle,
} from "../components/ui";
import { BellIcon, ChevronRightIcon, TicketIcon } from "../components/icons";

export function SettingsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [prefs, setPrefs] = useState<PreferenceRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [calendarFeed, setCalendarFeed] = useState("");
  const [feedMessage, setFeedMessage] = useState("");
  const [syncConnected, setSyncConnected] = useState(false);
  const [calendarError, setCalendarError] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMessage, setBackupMessage] = useState("");
  const [backupError, setBackupError] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([api.getPreferences(user.id), api.syncGetCalendarFeed(), api.syncGetConfig()]).then(([result, feed, config]) => {
      if (result.success && result.data) setPrefs(result.data);
      if (feed.success && feed.data) setCalendarFeed(feed.data);
      else setCalendarError(feed.error || "Could not load the calendar feed.");
      if (config.success && config.data) setSyncConnected(config.data.connected);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [user]);

  async function handleCreateBackup() {
    setBackupBusy(true);
    setBackupMessage("");
    setBackupError(false);
    try {
      const result = await api.createBackup();
      if (!result.success || !result.data) throw new Error(result.error || "Could not create a backup.");
      const backup = JSON.parse(result.data) as Record<string, unknown>;
      backup.localSettings = Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith("em:")));
      const url = URL.createObjectURL(new Blob([JSON.stringify(backup)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `eventpulse-desktop-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setBackupMessage("Full backup downloaded, including all local accounts, events, settings, sync data, and uploaded files. Store it somewhere safe.");
    } catch (error) {
      setBackupError(true);
      setBackupMessage(error instanceof Error ? error.message : "Could not create a backup.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleRestoreBackup(file?: File) {
    if (!file) return;
    if (!window.confirm("Restore this full backup? It replaces all data, accounts, settings, sync state, and uploaded files on this device. This cannot be undone.")) return;
    setBackupBusy(true);
    setBackupMessage("");
    setBackupError(false);
    try {
      const contents = await file.text();
      const backup = JSON.parse(contents) as { localSettings?: Record<string, unknown> };
      const result = await api.restoreBackup(contents);
      if (!result.success) throw new Error(result.error || "Could not restore this backup.");
      for (const key of Object.keys(localStorage)) if (key.startsWith("em:")) localStorage.removeItem(key);
      for (const [key, value] of Object.entries(backup.localSettings ?? {})) {
        if (key.startsWith("em:") && typeof value === "string") localStorage.setItem(key, value);
      }
      setBackupMessage("Backup restored successfully. Reloading the app…");
      window.setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      setBackupError(true);
      setBackupMessage(error instanceof Error ? error.message : "Could not restore this backup.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleSave() {
    if (!user || !prefs) return;
    setSaving(true);
    try {
      const result = await api.updatePreferences(user.id, {
        eventReminders: prefs.eventReminders,
        emailUpdates: prefs.emailUpdates,
        weeklyDigest: prefs.weeklyDigest,
        defaultCapacity: prefs.defaultCapacity,
      });
      if (result.success) {
        setMessage(syncConnected ? "Preferences saved. Syncing with the website…" : "Preferences saved on this device. Pair with the website to sync them.");
        if (syncConnected) {
          const sync = await api.syncNow();
          if (!sync.success) setMessage(sync.error || "Saved locally; website sync will retry.");
          else setMessage("Preferences saved and synced with the website.");
        }
        setTimeout(() => setMessage(""), 3000);
      } else setMessage(result.error || "Failed to save preferences.");
    } catch {
      setMessage("Failed to save preferences.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-40" />
        </div>
        <Skeleton className="h-[240px] rounded-2xl" />
        <Skeleton className="h-[160px] rounded-2xl" />
      </div>
    );
  }

  if (!user || !prefs) {
    return <p className="text-[12.5px] text-muted">No settings available.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Manage your workspace preferences and notifications."
        actions={
          <Button variant="secondary" onClick={() => navigate("/dashboard")}>
            Dashboard <ChevronRightIcon className="h-3.5 w-3.5" />
          </Button>
        }
      />

      {message && (
        <Alert tone={message.startsWith("Failed") ? "danger" : "success"}>
          {message}
        </Alert>
      )}

      <Section
        title="Notifications"
        description="Choose what EventPulse should tell you about"
        icon={<BellIcon className="h-4 w-4" />}
      >
        <div className="space-y-2.5">
          <Toggle
            checked={prefs.eventReminders}
            onChange={() =>
              setPrefs({ ...prefs, eventReminders: !prefs.eventReminders })
            }
            label="Event reminders"
            description="Get a nudge before an event you own or joined starts."
          />
          <Toggle
            checked={prefs.emailUpdates}
            onChange={() =>
              setPrefs({ ...prefs, emailUpdates: !prefs.emailUpdates })
            }
            label="Email updates"
            description="Receive an email when events change or people join."
          />
          <Toggle
            checked={prefs.weeklyDigest}
            onChange={() =>
              setPrefs({ ...prefs, weeklyDigest: !prefs.weeklyDigest })
            }
            label="Weekly digest"
            description="A Monday summary of everything coming up."
          />
        </div>
      </Section>

      <Section
        title="Defaults"
        description="Pre-filled values for new events"
        icon={<TicketIcon className="h-4 w-4" />}
      >
        <div className="max-w-xs">
          <Input
            id="defaultCapacity"
            label="Default capacity"
            type="number"
            min={1}
            max={100000}
            value={prefs.defaultCapacity ? String(prefs.defaultCapacity) : ""}
            onChange={(e) => {
              const value = e.currentTarget.value;
              setPrefs({
                ...prefs,
                defaultCapacity: value ? Number(value) : null,
              });
            }}
            placeholder="Unlimited"
            hint="Used as the starting value when you create an event."
          />
        </div>
      </Section>

      <Section title="Calendar feed" description="Subscribe in Google Calendar, Apple Calendar or Outlook to see events you own or joined." icon={<TicketIcon className="h-4 w-4" />}>
        {calendarFeed ? <>
          <Input id="desktop-calendar-feed" label="Calendar feed URL" value={calendarFeed} readOnly onFocus={(event) => event.currentTarget.select()} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(calendarFeed).then(() => setFeedMessage("Calendar URL copied."), () => setFeedMessage("Could not copy the URL. Select and copy it manually."))}>Copy feed URL</Button>
            <Button variant="secondary" onClick={() => void openUrl(calendarFeed).catch((error) => setFeedMessage(String(error)))}>Download .ics</Button>
            <Button variant="ghost" onClick={async () => { const result = await api.syncGetCalendarFeed(true); if (result.success && result.data) { setCalendarFeed(result.data); setFeedMessage("Feed link reset. Update any calendar subscriptions."); } else setFeedMessage(result.error || "Could not reset the feed link."); }}>Reset link</Button>
          </div>
          <p className="mt-2 text-[11px] text-faint">Anyone with this link can read your event list. Resetting it breaks existing subscriptions.</p>
        </> : <p className="text-[12px] text-muted">{syncConnected ? calendarError || feedMessage || "Calendar feed is available when the website is online." : "Pair with the website to manage your calendar feed."}</p>}
        {feedMessage && calendarFeed && <p role="status" className="mt-2 text-[11.5px] text-muted">{feedMessage}</p>}
      </Section>

      <Section title="Full backup & restore" description="Create a portable copy of all EventPulse data stored on this device." icon={<TicketIcon className="h-4 w-4" />}>
        <div className="space-y-3">
          <p className="text-[12px] leading-relaxed text-muted">Backups include all local user accounts, events, event work, preferences, sync configuration and queues, and uploaded files. Backup files contain sensitive data. Restoring replaces everything currently stored on this device.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void handleCreateBackup()} disabled={backupBusy}>{backupBusy ? "Working…" : "Download full backup"}</Button>
            <Button variant="danger" onClick={() => document.getElementById("desktop-backup-file")?.click()} disabled={backupBusy}>Restore from backup</Button>
            <input id="desktop-backup-file" type="file" accept=".json,application/json" className="hidden" onChange={(event) => { const file = event.currentTarget.files?.[0]; void handleRestoreBackup(file); event.currentTarget.value = ""; }} />
          </div>
          {backupMessage && <Alert tone={backupError ? "danger" : "success"}>{backupMessage}</Alert>}
        </div>
      </Section>

      <div className="flex justify-end border-t border-line-soft pt-5">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save preferences"}
        </Button>
      </div>
    </div>
  );
}
