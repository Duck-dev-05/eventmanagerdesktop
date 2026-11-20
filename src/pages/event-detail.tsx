"use client";

import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAuth } from "../App";
import { api } from "../lib/api";
import type { ActivityEntry, AvailableEventUser, EventMember, EventRecord, EventTeamInvitation, SessionUser, SyncedEventMember } from "../types";
import { FilesPanel, SchedulePanel, TasksPanel } from "../components/event-work-tabs";
import {
  Avatar,
  Badge,
  Button,
  Input,
  Section,
  Skeleton,
} from "../components/ui";
import {
  CalendarDotsIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  DownloadIcon,
  FileTextIcon,
  GridIcon,
  MapPinIcon,
  PulseIcon,
  SettingsIcon,
  ShareIcon,
  TicketIcon,
  UsersIcon,
} from "../components/icons";

type DetailTab = "overview" | "tasks" | "members" | "schedule" | "files" | "activity" | "settings";

const tabs: { id: DetailTab; label: string; Icon: typeof GridIcon }[] = [
  { id: "overview", label: "Overview", Icon: GridIcon },
  { id: "tasks", label: "Tasks", Icon: CheckCircleIcon },
  { id: "members", label: "Members", Icon: UsersIcon },
  { id: "schedule", label: "Schedule", Icon: CalendarDotsIcon },
  { id: "files", label: "Files", Icon: FileTextIcon },
  { id: "activity", label: "Activity", Icon: PulseIcon },
  { id: "settings", label: "Settings", Icon: SettingsIcon },
];

function formatLongDate(dateString: string) {
  return new Date(dateString).toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function EventDetailPage() {
  const { eventId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [members, setMembers] = useState<EventMember[]>([]);
  const [websiteMembers, setWebsiteMembers] = useState<SyncedEventMember[]>([]);
  const [availableUsers, setAvailableUsers] = useState<AvailableEventUser[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [memberRole, setMemberRole] = useState("member");
  const [inviteEmail, setInviteEmail] = useState("");
  const [pendingInvites, setPendingInvites] = useState<EventTeamInvitation[]>([]);
  const [memberBusy, setMemberBusy] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [websitePaired, setWebsitePaired] = useState(false);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateTitle, setDuplicateTitle] = useState("");
  const [duplicateStartsAt, setDuplicateStartsAt] = useState("");
  const [duplicateBusy, setDuplicateBusy] = useState(false);
  const [duplicateError, setDuplicateError] = useState("");

  useEffect(() => {
    if (!eventId || !user) return;
    let active = true;
    setLoading(true);
    Promise.all([
      api.getEvent(eventId, user?.id ?? ""),
      api.listEventMembers(eventId, user?.id ?? ""),
      api.listSyncedEventMembers(eventId, user?.id ?? ""),
      api.getEventActivity(eventId, user?.id ?? ""),
      api.syncGetConfig(),
      api.listAvailableEventUsers(eventId, user?.id ?? ""),
    ])
      .then(([eventResult, membersResult, websiteMembersResult, activityResult, syncResult, availableUsersResult]) => {
        if (!active) return;
        if (eventResult.success && eventResult.data) setEvent(eventResult.data);
        if (membersResult.success && membersResult.data) setMembers(membersResult.data);
        if (websiteMembersResult.success && websiteMembersResult.data) setWebsiteMembers(websiteMembersResult.data);
        if (activityResult.success && activityResult.data) setActivity(activityResult.data);
        if (syncResult.success && syncResult.data) setWebsitePaired(syncResult.data.connected);
        if (availableUsersResult.success && availableUsersResult.data) setAvailableUsers(availableUsersResult.data);
      })
      .catch((error) => console.error("Could not load event details", error))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [eventId, user]);

  const isOwner = event?.ownerId === user?.id;
  const currentMemberRole = websiteMembers.find((member) => member.userId === user?.id && member.status === "accepted")?.role
    ?? members.find((member) => member.userId === user?.id && member.status === "accepted")?.role;
  const hasEventRole = isOwner || Boolean(currentMemberRole);
  const canManageTeam = isOwner || currentMemberRole === "admin";
  const canManageEvent = isOwner || currentMemberRole === "admin";
  const canEditWork = isOwner || currentMemberRole === "member" || currentMemberRole === "admin";
  const canManageWork = isOwner || currentMemberRole === "admin";

  useEffect(() => {
    if (websitePaired && canManageTeam && eventId && user?.id) void refreshRemoteTeam();
  }, [websitePaired, canManageTeam, eventId, user?.id]);

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-[150px] rounded-2xl" />
        <Skeleton className="h-12 rounded-xl" />
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Skeleton className="h-[300px] rounded-2xl xl:col-span-2" />
          <Skeleton className="h-[300px] rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="rounded-2xl border border-line bg-panel p-10 text-center shadow-panel">
        <p className="text-[13px] text-muted">Event not found.</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate("/my-events")}>
          Back to events
        </Button>
      </div>
    );
  }

  const currentEvent = event;
  const start = new Date(currentEvent.startsAt);
  const isUpcoming = start.getTime() >= Date.now();
  const websiteEventUrl = `https://eventmanager-5dsz.vercel.app/events/${currentEvent.id}`;

  function startDuplicate() {
    setDuplicateTitle(`${currentEvent.title} (copy)`);
    const copyDate = new Date(currentEvent.startsAt);
    copyDate.setDate(copyDate.getDate() + 7);
    setDuplicateStartsAt(`${copyDate.getFullYear()}-${String(copyDate.getMonth() + 1).padStart(2, "0")}-${String(copyDate.getDate()).padStart(2, "0")}T${String(copyDate.getHours()).padStart(2, "0")}:${String(copyDate.getMinutes()).padStart(2, "0")}`);
    setDuplicateError("");
    setDuplicateOpen(true);
  }

  async function duplicateEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || !eventId) return;
    if (duplicateTitle.trim().length < 3) {
      setDuplicateError("Event title must be at least 3 characters.");
      return;
    }
    if (!duplicateStartsAt || Number.isNaN(new Date(duplicateStartsAt).getTime())) {
      setDuplicateError("Enter a valid event date and time.");
      return;
    }
    setDuplicateBusy(true);
    setDuplicateError("");
    try {
      const result = await api.duplicateEvent(eventId, user.id, duplicateTitle, new Date(duplicateStartsAt).toISOString());
      if (result.success && result.data) {
        navigate(`/events/${result.data.id}`);
        return;
      }
      setDuplicateError(result.error || "Could not duplicate this event.");
    } catch (reason) {
      setDuplicateError(reason instanceof Error ? reason.message : "Could not duplicate this event.");
    } finally {
      setDuplicateBusy(false);
    }
  }

  function downloadCalendarEvent() {
    const escapeIcs = (value: string) => value
      .replace(/\\/g, "\\\\")
      .replace(/\r\n|\r|\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
    const utcStamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    const encoder = new TextEncoder();
    const foldLine = (line: string) => {
      const chunks: string[] = [];
      let chunk = "";
      let byteLength = 0;
      for (const character of line) {
        const characterBytes = encoder.encode(character).length;
        if (byteLength + characterBytes > 75) {
          chunks.push(chunk);
          chunk = " ";
          byteLength = 1;
        }
        chunk += character;
        byteLength += characterBytes;
      }
      chunks.push(chunk);
      return chunks.join("\r\n");
    };
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    const lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EventPulse//Desktop//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "BEGIN:VEVENT",
      `UID:${currentEvent.id}@eventpulse`, `DTSTAMP:${utcStamp(new Date())}`,
      `DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`, `SUMMARY:${escapeIcs(currentEvent.title)}`,
      `DESCRIPTION:${escapeIcs(currentEvent.description)}`, `LOCATION:${escapeIcs(currentEvent.venue)}`,
      "END:VEVENT", "END:VCALENDAR",
    ];
    const content = `${lines.map(foldLine).join("\r\n")}\r\n`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/calendar;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    const fileName = currentEvent.title.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "event";
    anchor.download = `${fileName}.ics`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async function refreshRemoteTeam() {
    if (!eventId || !user) return;
    const [details, available] = await Promise.all([
      api.manageEventMember(eventId, user.id, "details"),
      api.listAvailableEventUsers(eventId, user.id),
    ]);
    if (details.success && details.data) {
      if (Array.isArray(details.data.members)) setWebsiteMembers(details.data.members as SyncedEventMember[]);
      if (Array.isArray(details.data.invitations)) setPendingInvites(details.data.invitations as EventTeamInvitation[]);
    }
    if (available.success && available.data) setAvailableUsers(available.data);
  }

  async function addExistingUser() {
    if (!eventId || !user || !selectedUserId) return;
    const selected = availableUsers.find((person) => person.id === selectedUserId);
    if (!selected) return;
    setMemberBusy(true);
    setMemberError(null);
    const result = await api.addExistingEventMember(eventId, user.id, selectedUserId, memberRole);
    if (result.success) {
      setAvailableUsers((previous) => previous.filter((person) => person.id !== selected.id));
      setSelectedUserId("");
      await refreshRemoteTeam();
    } else {
      setMemberError(result.error || "Could not add this user to the event.");
    }
    setMemberBusy(false);
  }

  async function inviteByEmail() {
    if (!eventId || !user || !inviteEmail.trim()) return;
    setMemberBusy(true); setMemberError(null);
    const result = await api.manageEventMember(eventId, user.id, "invite", { email: inviteEmail.trim(), role: memberRole });
    if (result.success) {
      setInviteEmail("");
      setMemberError(result.data?.message as string || "Invitation created.");
      await refreshRemoteTeam();
    } else setMemberError(result.error || "Could not send the invitation.");
    setMemberBusy(false);
  }

  async function updateTeamMember(memberId: string, action: "change-role" | "remove", role?: string) {
    if (!eventId || !user) return;
    if (action === "remove" && !window.confirm("Remove this person from the event?")) return;
    setMemberBusy(true); setMemberError(null);
    const result = await api.manageEventMember(eventId, user.id, action, { memberId, role });
    if (!result.success) setMemberError(result.error || "Could not update this member.");
    else await refreshRemoteTeam();
    setMemberBusy(false);
  }

  async function updateTeamInvitation(inviteId: string, action: "resend" | "cancel-invitation") {
    if (!eventId || !user) return;
    if (action === "cancel-invitation" && !window.confirm("Cancel this pending invitation?")) return;
    setMemberBusy(true); setMemberError(null);
    const result = await api.manageEventMember(eventId, user.id, action, { inviteId });
    if (!result.success) setMemberError(result.error || "Could not update this invitation.");
    else {
      if (result.data?.message) setMemberError(result.data.message as string);
      await refreshRemoteTeam();
    }
    setMemberBusy(false);
  }

  async function copyEventLink() {
    try {
      await navigator.clipboard.writeText(websiteEventUrl);
      setShareMessage("Event link copied.");
    } catch {
      setShareMessage(websiteEventUrl);
    }
  }
  const organizer = event.ownerId === user?.id ? user : null;
  const displayedMembers = websitePaired
    ? websiteMembers.map((member) => ({
        id: member.id,
        userId: member.userId,
        name: member.name,
        email: member.email,
        avatarUrl: member.avatarUrl,
        role: member.role,
      }))
    : members.map((member) => ({
        id: member.id,
        userId: member.userId,
        name: member.role || "Member",
        email: member.status,
        avatarUrl: null,
        role: member.role,
      }));
  const timeline = [
    ...activity,
    {
      id: "event-created",
      kind: "event",
      summary: `${organizer?.name ?? "The organizer"} created this event.`,
      createdAt: event.createdAt,
      actorName: organizer?.name ?? null,
      actorAvatarUrl: organizer?.avatarUrl ?? null,
    },
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Shared event header, matching the website's event workspace. */}
      <section className="relative overflow-visible rounded-2xl border border-line bg-panel px-5 py-5 shadow-panel sm:px-7">
        <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-20 h-48 w-48 overflow-hidden rounded-2xl bg-gradient-to-br from-accent-soft/80 to-success-soft/70 blur-3xl" />
        <div className="relative flex flex-col gap-4 xl:flex-row xl:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <div className="flex h-[58px] w-[58px] shrink-0 flex-col items-center justify-center rounded-2xl bg-nav text-white shadow-sm">
              <span className="font-mono text-[9px] font-bold uppercase tracking-eyebrow text-[#f4bc8f]">{start.toLocaleDateString(undefined, { month: "short" })}</span>
              <span className="text-[23px] font-semibold leading-none">{start.getDate()}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={isUpcoming ? "success" : "neutral"}>{isUpcoming ? "Upcoming" : "Past"}</Badge>
                <Badge tone="accent">{event.category || "Event"}</Badge>
                <Badge tone="neutral">{event.visibility === "public" ? "Public" : "Private"}</Badge>
              </div>
              <h1 className="mt-1.5 truncate text-[22px] font-semibold leading-tight tracking-tight text-ink">{event.title}</h1>
              <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted">
                <span className="inline-flex items-center gap-1.5"><ClockIcon className="h-3.5 w-3.5 text-faint" />{start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span>
                <span className="inline-flex items-center gap-1.5"><MapPinIcon className="h-3.5 w-3.5 text-faint" />{event.venue || "Location to be announced"}</span>
                <span className="inline-flex items-center gap-1.5"><UsersIcon className="h-3.5 w-3.5 text-faint" />{event.capacity ? `Up to ${event.capacity} guests` : "No capacity limit"}</span>
                {isUpcoming && <span className="text-muted">· {Math.max(0, Math.ceil((start.getTime() - Date.now()) / 86_400_000))} days</span>}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {hasEventRole && <Button variant="secondary" size="sm" onClick={() => navigate(`/events/${eventId}/print`)}>Print run sheet</Button>}
            <Button variant="secondary" size="sm" onClick={downloadCalendarEvent}><DownloadIcon className="h-3.5 w-3.5" />Add to calendar</Button>
            {isOwner && <Button variant="secondary" size="sm" onClick={startDuplicate}>Duplicate</Button>}
            {canManageEvent && <Button variant="secondary" size="sm" onClick={() => navigate(`/events/${eventId}/edit`)}><SettingsIcon className="h-3.5 w-3.5" />Settings</Button>}
            <div className="relative">
              <Button variant="secondary" size="sm" onClick={() => { setShareOpen((open) => !open); setShareMessage(""); }}><ShareIcon className="h-3.5 w-3.5" />Share <span aria-hidden="true">⌄</span></Button>
              {shareOpen && <div className="absolute right-0 top-[calc(100%+8px)] z-20 w-64 rounded-xl border border-line bg-panel p-2 shadow-xl">
                <button type="button" onClick={() => void copyEventLink()} className="w-full rounded-lg px-3 py-2 text-left text-[12px] font-medium text-ink hover:bg-sunken">Copy website event link</button>
                <button type="button" onClick={() => void openUrl(websiteEventUrl).catch((error) => setShareMessage(String(error)))} className="w-full rounded-lg px-3 py-2 text-left text-[12px] font-medium text-ink hover:bg-sunken">Open event on website</button>
                {shareMessage && <p className="break-all px-3 py-2 text-[10.5px] text-muted">{shareMessage}</p>}
              </div>}
            </div>
          </div>
        </div>
      </section>

      {duplicateOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !duplicateBusy) setDuplicateOpen(false); }}>
        <section role="dialog" aria-modal="true" aria-labelledby="duplicate-event-title" className="w-full max-w-md rounded-2xl border border-line bg-panel p-6 shadow-xl">
          <h2 id="duplicate-event-title" className="text-lg font-semibold text-ink">Duplicate event</h2>
          <p className="mt-1 text-[12px] text-muted">Copies the event details, agenda, and open task checklist.</p>
          <form onSubmit={(event) => void duplicateEvent(event)} className="mt-5 space-y-4">
            <Input id="duplicate-title" label="New event name" value={duplicateTitle} onChange={(event) => setDuplicateTitle(event.currentTarget.value)} required minLength={3} maxLength={160} />
            <Input id="duplicate-start" label="New start date and time" type="datetime-local" value={duplicateStartsAt} onChange={(event) => setDuplicateStartsAt(event.currentTarget.value)} required />
            {duplicateError && <p role="alert" className="text-[12px] text-danger">{duplicateError}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="secondary" disabled={duplicateBusy} onClick={() => setDuplicateOpen(false)}>Cancel</Button><Button type="submit" disabled={duplicateBusy}>{duplicateBusy ? "Duplicating…" : "Create copy"}</Button></div>
          </form>
        </section>
      </div>}

      {/* Event tabs */}
      <nav className="overflow-x-auto border-b border-line" aria-label="Event sections">
        <ul className="flex min-w-max items-center gap-5 sm:gap-8">
          {tabs.filter(({ id }) => (hasEventRole || id === "overview" || id === "activity") && (id !== "settings" || canManageEvent)).map(({ id, label, Icon }) => (
            <li key={id}>
              <button
                type="button"
                aria-current={tab === id ? "page" : undefined}
                onClick={() => {
                  if (id === "settings") {
                    if (canManageEvent) navigate(`/events/${eventId}/edit`);
                    return;
                  }
                  setShareOpen(false);
                  setTab(id);
                }}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-1 py-3 text-[12.5px] font-semibold transition-colors ${tab === id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink"}`}
              >
                <Icon className="h-4 w-4" />{label}
                {id === "members" && <span className="rounded-full bg-sunken px-1.5 py-0.5 text-[10px]">{displayedMembers.length + 1}</span>}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {tab === "overview" && (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-3">
          <div className="space-y-5 xl:col-span-2">
            <Section title="About this event" description="Event description" icon={<TicketIcon className="h-4 w-4" />}>
              <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-muted">
                {event.description || "No description was added for this event."}
              </p>
            </Section>
            <Section title="At a glance" description="Key facts about this event.">
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  ["Category", event.category || "—"],
                  ["Venue", event.venue || "—"],
                  ["Capacity", event.capacity ? String(event.capacity) : "Unlimited"],
                  ["Status", isUpcoming ? "Upcoming" : "Past"],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 border-l-2 border-accent-line pl-3">
                    <dt className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-faint">{label}</dt>
                    <dd className="mt-1.5 truncate text-[13px] font-medium text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          </div>

          <aside className="space-y-5">
            <Section title="Organizer" description="Event owner" icon={<UsersIcon className="h-4 w-4" />}>
              <div className="flex items-center gap-3">
                <Avatar name={organizer?.name ?? "Event Organizer"} src={organizer?.avatarUrl} size="md" />
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-ink">{organizer?.name ?? "Event Organizer"}</p>
                  {organizer?.email && <p className="truncate text-[11.5px] text-muted">{organizer.email}</p>}
                  {!organizer && <p className="text-[11.5px] text-muted">Event owner</p>}
                </div>
              </div>
            </Section>
            <Section title="Schedule" description="When and where" icon={<CalendarIcon className="h-4 w-4" />}>
              <dl className="space-y-3">
                <div className="flex items-baseline justify-between gap-3"><dt className="text-[12px] text-muted">Date</dt><dd className="text-right text-[12.5px] font-medium text-ink">{formatLongDate(event.startsAt)}</dd></div>
                <div className="flex items-center justify-between gap-3"><dt className="flex items-center gap-1.5 text-[12px] text-muted"><ClockIcon className="h-3.5 w-3.5" />Start</dt><dd className="text-[12.5px] font-medium text-ink">{start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</dd></div>
                <div className="flex items-start justify-between gap-3"><dt className="flex items-center gap-1.5 text-[12px] text-muted"><MapPinIcon className="h-3.5 w-3.5" />Venue</dt><dd className="max-w-[180px] text-right text-[12.5px] font-medium text-ink">{event.venue || "Location to be announced"}</dd></div>
              </dl>
            </Section>
          </aside>
        </div>
      )}

      {tab === "members" && (
        <Section title="Team members" description="People with access to this event" icon={<UsersIcon className="h-4 w-4" />} bodyClassName="p-0">
          {canManageTeam && websitePaired && (
            <div className="space-y-3 border-b border-line-soft p-4">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[220px] flex-1 text-[11.5px] font-medium text-muted">Invite by email
                  <input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="name@example.com" className="mt-1.5 h-10 w-full rounded-xl border border-line bg-panel px-3 text-[12px] text-ink" />
                </label>
                <label className="text-[11.5px] font-medium text-muted">Role
                  <select value={memberRole} onChange={(event) => setMemberRole(event.target.value)} className="mt-1.5 h-10 rounded-xl border border-line bg-panel px-3 text-[12px] text-ink"><option value="member">Member</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select>
                </label>
                <Button disabled={!inviteEmail.trim() || memberBusy} onClick={() => void inviteByEmail()}>{memberBusy ? "Sending…" : "Send invitation"}</Button>
              </div>
              {availableUsers.length > 0 && <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[220px] flex-1 text-[11.5px] font-medium text-muted">Or add an existing workspace user
                  <select value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)} className="mt-1.5 h-10 w-full rounded-xl border border-line bg-panel px-3 text-[12px] text-ink"><option value="">Choose a person</option>{availableUsers.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}</select>
                </label>
                <Button disabled={!selectedUserId || memberBusy} onClick={() => void addExistingUser()}>{memberBusy ? "Adding…" : "Add existing user"}</Button>
              </div>}
              {memberError && <p role="status" className="text-[12px] text-muted">{memberError}</p>}
            </div>
          )}
          <ul className="divide-y divide-line-soft">
            <li className="flex items-center gap-3 px-5 py-4">
              <Avatar name={organizer?.name ?? "Event Organizer"} src={organizer?.avatarUrl} size="sm" />
              <div className="min-w-0 flex-1"><p className="truncate text-[12.5px] font-semibold text-ink">{organizer?.name ?? "Event Organizer"}{organizer ? " (you)" : ""}</p><p className="truncate text-[11.5px] text-muted">{organizer?.email ?? "Organizer"}</p></div>
              <Badge tone="accent">Owner</Badge>
            </li>
            {displayedMembers.map((member) => (
              <li key={member.id} className="flex items-center gap-3 px-5 py-4">
                <Avatar name={member.name} src={member.avatarUrl} size="sm" />
                <div className="min-w-0 flex-1"><p className="truncate text-[12.5px] font-semibold text-ink">{member.name}</p><p className="truncate text-[11.5px] text-muted">{member.email}</p></div>
                <Badge tone={member.role === "admin" ? "accent" : "neutral"}>{member.role.charAt(0).toUpperCase() + member.role.slice(1)}</Badge>
                {canManageTeam && websitePaired && member.userId !== user?.id && <>
                  {isOwner && <select aria-label={`Change ${member.name}'s role`} value={member.role} disabled={memberBusy} onChange={(event) => void updateTeamMember(member.userId, "change-role", event.target.value)} className="h-8 rounded-lg border border-line bg-panel px-2 text-[11px]"><option value="member">Member</option><option value="admin">Admin</option><option value="viewer">Viewer</option></select>}
                  {(isOwner || member.role === "member" || member.role === "viewer") && <Button size="sm" variant="danger" disabled={memberBusy} onClick={() => void updateTeamMember(member.userId, "remove")}>Remove</Button>}
                </>}
              </li>
            ))}
            {displayedMembers.length === 0 && <li className="px-5 py-8 text-center text-[12.5px] text-muted">No other team members yet.</li>}
          </ul>
          {websitePaired && pendingInvites.length > 0 && <div className="border-t border-line-soft">
            <h3 className="px-5 py-3 text-[11px] font-semibold uppercase tracking-wide text-muted">Pending invitations</h3>
            <ul className="divide-y divide-line-soft">{pendingInvites.map((invite) => <li key={invite.id} className="flex flex-wrap items-center gap-3 px-5 py-3"><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-ink">{invite.email}</span><span className="text-[10.5px] text-muted">{invite.role} · expires {new Date(invite.expiresAt).toLocaleDateString()}</span></span>{canManageTeam && <><Button size="sm" variant="secondary" disabled={memberBusy} onClick={() => void updateTeamInvitation(invite.id, "resend")}>Resend</Button><Button size="sm" variant="danger" disabled={memberBusy} onClick={() => void updateTeamInvitation(invite.id, "cancel-invitation")}>Cancel</Button></>}</li>)}</ul>
          </div>}
        </Section>
      )}

      {tab === "tasks" && <TasksPanel event={event} user={user as SessionUser} canEdit={canEditWork} canDelete={canManageWork} />}

      {tab === "schedule" && <SchedulePanel event={event} user={user as SessionUser} canEdit={canEditWork} />}

      {tab === "files" && <FilesPanel event={event} user={user as SessionUser} canManage={canManageWork} />}

      {tab === "activity" && (
        <Section title="Activity" description="A running log of what happens inside this event." icon={<PulseIcon className="h-4 w-4" />}>
          <ol className="relative space-y-7 border-l-2 border-line-soft pl-8">
            {timeline.map((entry) => (
              <li key={entry.id} className="relative">
                <span className="absolute -left-[43px] flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent ring-2 ring-panel"><CalendarIcon className="h-4 w-4" /></span>
                <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-[13px] font-semibold text-ink">{entry.kind === "event" ? "Event" : entry.kind}</p><time className="text-[11px] text-faint">{new Date(entry.createdAt).toLocaleString()}</time></div>
                <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{entry.summary}</p>
                <p className="mt-1 font-mono text-[9px] uppercase tracking-eyebrow text-faint">{entry.actorName || "System"}</p>
              </li>
            ))}
          </ol>
          {activity.length === 0 && <p className="mt-6 rounded-xl border border-dashed border-line bg-sunken/50 px-5 py-5 text-center text-[12px] text-muted">Nothing else has happened yet. Event updates will appear here.</p>}
        </Section>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" onClick={() => navigate("/my-events")}>Back to my events</Button>
      </div>
    </div>
  );
}
