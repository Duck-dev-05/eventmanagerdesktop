"use client";

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../App";
import { api } from "../lib/api";
import type { EventRecord, SyncConfigInfo } from "../types";
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Input,
  PageHeader,
  Section,
  Skeleton,
} from "../components/ui";
import {
  ArrowRightIcon,
  BellIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  MailIcon,
  SettingsIcon,
  UserIcon,
} from "../components/icons";

function ProfileLink({
  to,
  icon,
  title,
  description,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl border border-line-soft bg-white p-4 transition-colors hover:border-[#d8d5fb] hover:bg-[#fafaff]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#f0efff] text-[#6558d3]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[11.5px] text-muted">{description}</span>
      </span>
      <ArrowRightIcon className="h-4 w-4 shrink-0 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-[#6558d3]" />
    </Link>
  );
}

export function ProfilePage() {
  const { user, refreshUser } = useAuth();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [name, setName] = useState(user?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileNotice, setProfileNotice] = useState("");
  const [sync, setSync] = useState<SyncConfigInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarError, setAvatarError] = useState("");
  const [avatarNotice, setAvatarNotice] = useState("");
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [hasGooglePhoto, setHasGooglePhoto] = useState(false);
  const avatarInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;

    Promise.all([api.listEvents(user.id), api.syncGetConfig()])
      .then(async ([eventsResult, syncResult]) => {
        if (!active) return;
        if (eventsResult.success && eventsResult.data) setEvents(eventsResult.data);
        if (syncResult.success && syncResult.data) setSync(syncResult.data);
        if (syncResult.data?.connected) {
          const profileResult = await api.syncManageProfile("get");
          if (active && profileResult.success && profileResult.data?.profile) {
            setHasGooglePhoto(Boolean(profileResult.data.profile.googleAvatarUrl));
            const updated = { ...user, name: profileResult.data.profile.name, avatarUrl: profileResult.data.profile.avatarUrl };
            localStorage.setItem("em:user", JSON.stringify(updated));
            await refreshUser();
          }
        }
      })
      .catch((error) => console.error("Could not load profile overview", error))
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-44 rounded-2xl" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <p className="text-[12.5px] text-muted">No profile available.</p>;
  }

  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!user) return;
    setSaving(true); setProfileError(""); setProfileNotice("");
    try {
      const paired = await api.syncGetConfig();
      if (paired.data?.connected) {
        const result = await api.syncManageProfile("update-name", { name });
        if (!result.success || !result.data?.profile) throw new Error(result.error || "Could not update your website profile.");
        const updated = { ...user, name: result.data.profile.name, avatarUrl: result.data.profile.avatarUrl };
        localStorage.setItem("em:user", JSON.stringify(updated));
        await refreshUser();
        setName(updated.name);
        setProfileNotice("Your website profile name has been updated.");
      } else {
        const result = await api.updateProfile(user.id, name);
        if (result.success && result.data) {
          localStorage.setItem("em:user", JSON.stringify(result.data));
          await refreshUser();
          setName(result.data.name);
          setProfileNotice("Your profile name has been updated on this device.");
        } else setProfileError(result.error || "Could not update your profile.");
      }
    } catch (reason) { setProfileError(String(reason)); }
    finally { setSaving(false); }
  }

  async function updateAvatar(action: string, options: { mimeType?: string; dataBase64?: string } = {}) {
    setAvatarBusy(true); setAvatarError(""); setAvatarNotice("");
    try {
      const paired = await api.syncGetConfig();
      if (!paired.data?.connected) throw new Error("Pair with the website and connect to the internet to manage your profile photo.");
      const result = await api.syncManageProfile(action, options);
      if (!result.success || !result.data?.profile) throw new Error(result.error || "Could not update your profile photo.");
      const updated = { ...user!, name: result.data.profile.name, avatarUrl: result.data.profile.avatarUrl };
      localStorage.setItem("em:user", JSON.stringify(updated));
      await refreshUser();
      setAvatarNotice(action === "upload-avatar" ? "Profile photo updated." : action === "remove-avatar" ? "Profile photo removed." : "Google photo selected.");
    } catch (reason) { setAvatarError(String(reason)); }
    finally { setAvatarBusy(false); }
  }

  async function uploadAvatar(file?: File) {
    if (!file) return;
    setAvatarError("");
    const types: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp" };
    if (!types[file.type]) { setAvatarError("Use a PNG, JPEG or WebP image."); return; }
    if (file.size > 2 * 1024 * 1024) { setAvatarError("Keep profile photos under 2 MB."); return; }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
      await updateAvatar("upload-avatar", { mimeType: file.type, dataBase64: btoa(binary) });
    } catch (reason) { setAvatarError(String(reason)); }
  }

  const upcomingCount = events.filter((event) => new Date(event.startsAt).getTime() >= Date.now()).length;
  const roleLabel = user.workspaceRole
    ? user.workspaceRole.charAt(0).toUpperCase() + user.workspaceRole.slice(1)
    : "Member";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Account"
        title="Your profile"
        description="Your account identity, workspace access and preferences."
      />

      <Section>
        <div className="relative overflow-hidden">
          <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-24 h-56 w-56 rounded-full bg-[#6558d3]/10 blur-3xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
            <Avatar name={user.name} src={user.avatarUrl} size="lg" className="!h-16 !w-16 !text-lg" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-[20px] font-semibold tracking-tight text-ink">{user.name}</h2>
                <Badge tone={user.workspaceRole === "owner" ? "warning" : "accent"}>{roleLabel}</Badge>
              </div>
              <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted">
                <MailIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{user.email}</span>
              </p>
              <p className="mt-2 text-[11.5px] text-faint">Update your display name below. Your sign-in email cannot be changed here.</p>
            </div>
            <Link to="/settings" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-line bg-white px-3.5 py-2.5 text-[12px] font-semibold text-ink-soft transition-colors hover:border-[#d8d5fb] hover:bg-[#fafaff] hover:text-[#5146bd]">
              <SettingsIcon className="h-4 w-4" /> Account settings
            </Link>
          </div>
        </div>
      </Section>

      <section aria-label="Workspace overview" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white p-4 shadow-panel">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f0efff] text-[#6558d3]"><CalendarIcon className="h-[18px] w-[18px]" /></span>
          <span><span className="block text-[21px] font-semibold leading-none text-ink">{events.length}</span><span className="mt-1.5 block text-[11.5px] text-muted">Events in workspace</span></span>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white p-4 shadow-panel">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><ClockIcon className="h-[18px] w-[18px]" /></span>
          <span><span className="block text-[21px] font-semibold leading-none text-ink">{upcomingCount}</span><span className="mt-1.5 block text-[11.5px] text-muted">Upcoming events</span></span>
        </div>
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-white p-4 shadow-panel">
          <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${sync?.connected ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}><CheckCircleIcon className="h-[18px] w-[18px]" /></span>
          <span><span className="block text-[13px] font-semibold leading-none text-ink">{sync?.connected ? "Connected" : "Not connected"}</span><span className="mt-1.5 block text-[11.5px] text-muted">Website sync</span></span>
        </div>
      </section>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <Section
          title="Account information"
          description="Your identity across EventPulse"
          icon={<UserIcon className="h-4 w-4" />}
        >
          {profileError && <Alert tone="danger">{profileError}</Alert>}
          {profileNotice && <Alert tone="success">{profileNotice}</Alert>}
          {avatarError && <Alert tone="danger">{avatarError}</Alert>}
          {avatarNotice && <Alert tone="success">{avatarNotice}</Alert>}
          <div className="mb-5 space-y-3 border-b border-line-soft pb-5">
            <h3 className="text-[12px] font-semibold text-ink">Profile photo</h3>
            <p className="text-[11.5px] text-muted">PNG, JPEG or WebP up to 2 MB. Photo changes require an online website pairing.</p>
            <input ref={avatarInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(event) => { const file = event.currentTarget.files?.[0]; void uploadAvatar(file); event.currentTarget.value = ""; }} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={avatarBusy} onClick={() => avatarInput.current?.click()}>{avatarBusy ? "Saving…" : "Upload photo"}</Button>
              {user.avatarUrl && <Button type="button" variant="secondary" disabled={avatarBusy} onClick={() => void updateAvatar("remove-avatar")}>Remove photo</Button>}
              {hasGooglePhoto && <Button type="button" variant="ghost" disabled={avatarBusy} onClick={() => void updateAvatar("google-avatar")}>Use Google photo</Button>}
            </div>
          </div>
          <form onSubmit={(e) => void saveProfile(e)} className="mb-5 space-y-3 border-b border-line-soft pb-5">
            <Input id="profile-display-name" label="Display name" value={name} onChange={(e) => setName(e.currentTarget.value)} required maxLength={80} />
            <Input id="profile-email" label="Email address" value={user.email} disabled />
            <div className="flex justify-end"><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save profile"}</Button></div>
          </form>
          <dl className="divide-y divide-line-soft">
            <div className="flex flex-col gap-1 py-3 first:pt-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <dt className="text-[12px] text-muted">Full name</dt>
              <dd className="break-all text-[12.5px] font-semibold text-ink sm:text-right">{user.name}</dd>
            </div>
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <dt className="text-[12px] text-muted">Email address</dt>
              <dd className="break-all text-[12.5px] font-semibold text-ink sm:text-right">{user.email}</dd>
            </div>
            <div className="flex flex-col gap-1 py-3 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <dt className="text-[12px] text-muted">Workspace role</dt>
              <dd className="sm:text-right"><Badge tone={user.workspaceRole === "owner" ? "warning" : "neutral"}>{roleLabel}</Badge></dd>
            </div>
          </dl>
          <p className="mt-4 rounded-xl bg-[#f7f7fc] px-3.5 py-3 text-[11.5px] leading-relaxed text-muted">
            Your email address is used to sign in and cannot be changed here. Your display name can be updated above.
          </p>
        </Section>

        <Section
          title="Your preferences"
          description="Quick access to account tools"
          icon={<SettingsIcon className="h-4 w-4" />}
          bodyClassName="space-y-2.5 p-3"
        >
          <ProfileLink to="/settings" icon={<BellIcon className="h-4 w-4" />} title="Notifications" description="Choose reminders and updates" />
          <ProfileLink to="/my-events" icon={<CalendarIcon className="h-4 w-4" />} title="My events" description="View events you own or joined" />
        </Section>
      </div>
    </div>
  );
}
