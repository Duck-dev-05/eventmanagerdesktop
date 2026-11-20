"use client";

import { useCallback, useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../App";
import { listen } from "@tauri-apps/api/event";
import { api } from "../lib/api";
import type { EventRecord, SyncedInvitation } from "../types";
import { Alert, Badge, Button, EmptyState, PageHeader, Section, Skeleton } from "../components/ui";
import { InvitationComposer } from "../components/invitation-composer";
import { CalendarIcon, MailIcon, MapPinIcon } from "../components/icons";

type Status = "pending" | "accepted" | "declined";
const statusTabs: Status[] = ["pending", "accepted", "declined"];
export function InvitationsPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const active = statusTabs.includes(params.get("status") as Status) ? params.get("status") as Status : "pending";
  const [invitations, setInvitations] = useState<SyncedInvitation[]>([]);
  const [sharedEvents, setSharedEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [result, sharedResult] = await Promise.all([
        api.listSyncedInvitations(user.id),
        api.listSyncedSharedEvents(user.id),
      ]);
      if (result.success && result.data) setInvitations(result.data);
      else setError(result.error || "Invitations could not be loaded.");
      if (sharedResult.success && sharedResult.data) setSharedEvents(sharedResult.data);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen("sync-applied", () => { void load(); }).then((stop) => { unlisten = stop; });
    return () => unlisten?.();
  }, [load]);

  async function respond(invitation: SyncedInvitation, response: "accept" | "decline") {
    if (!user) return;
    setBusyId(invitation.id);
    setError(null);
    const result = await api.respondToSyncedInvitation(user.id, invitation.id, response);
    if (result.success) {
      setInvitations((previous) => previous.map((item) => item.id === invitation.id ? { ...item, status: response === "accept" ? "accepted" : "declined" } : item));
    } else {
      setError(result.error || "Could not respond to this invitation.");
    }
    setBusyId(null);
  }

  const acceptedInvitations = invitations.filter((item) => item.status === "accepted");
  const acceptedEventIds = new Set(acceptedInvitations.map((item) => item.eventId));
  const extraSharedEvents = sharedEvents.filter((event) => !acceptedEventIds.has(event.id));
  const visibleSharedEvents = active === "accepted" ? extraSharedEvents : [];
  const counts = {
    pending: invitations.filter((item) => item.status === "pending").length,
    accepted: acceptedInvitations.length + extraSharedEvents.length,
    declined: invitations.filter((item) => item.status === "declined").length,
  };
  const visible = invitations.filter((item) => item.status === active);

  return <div className="space-y-6">
    <PageHeader eyebrow="Inbox" title="Invitations" description="Review, respond to, and send event invitations from this page." actions={<Button variant="secondary" onClick={() => void load()}>Refresh</Button>} />
    {user && <InvitationComposer userId={user.id} />}
    <nav aria-label="Invitation status" className="flex flex-wrap gap-1.5">{statusTabs.map((status) => <button key={status} type="button" aria-pressed={active === status} onClick={() => setParams({ status })} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11.5px] font-semibold capitalize ${active === status ? "bg-nav text-white" : "bg-panel text-muted ring-1 ring-inset ring-line hover:bg-sunken"}`}>{status}<span className={`rounded-full px-1.5 text-[10px] tabular-nums ${active === status ? "bg-white/15" : "bg-sunken"}`}>{counts[status]}</span></button>)}</nav>
    {error && <Alert tone="danger">{error}</Alert>}
    {loading ? <Skeleton className="h-[280px]" /> : visible.length || visibleSharedEvents.length ? <Section bodyClassName="p-0"><ul className="divide-y divide-line-soft">{visible.map((invitation) => <li key={invitation.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap gap-2"><Badge tone="accent">{invitation.role}</Badge><Badge>{invitation.category}</Badge>{active !== "pending" && <Badge tone={active === "accepted" ? "success" : "neutral"}>{active}</Badge>}</div><h2 className="mt-2 text-[15px] font-semibold text-ink">{invitation.eventTitle}</h2><p className="mt-1 text-[12px] text-muted">{invitation.inviterName ? `${invitation.inviterName} invited you as ${invitation.role}.` : `You were invited as ${invitation.role}.`}</p><p className="mt-3 flex flex-wrap gap-4 text-[11.5px] text-muted"><span className="inline-flex items-center gap-1.5"><CalendarIcon className="h-3.5 w-3.5" />{new Date(invitation.startsAt).toLocaleString()}</span><span className="inline-flex items-center gap-1.5"><MapPinIcon className="h-3.5 w-3.5" />{invitation.venue || "Location to be announced"}</span></p>{active === "pending" && <p className="mt-2 text-[11px] text-faint">Expires {new Date(invitation.expiresAt).toLocaleDateString()}</p>}</div>{active === "pending" && <div className="flex shrink-0 gap-2"><Button size="sm" disabled={busyId === invitation.id} onClick={() => void respond(invitation, "accept")}>{busyId === invitation.id ? "Saving…" : "Accept invitation"}</Button><Button size="sm" variant="secondary" disabled={busyId === invitation.id} onClick={() => void respond(invitation, "decline")}>Decline</Button></div>}</div>{active === "accepted" && <button type="button" onClick={() => void openUrl(`https://eventmanager-5dsz.vercel.app/events/${invitation.eventId}`)} className="mt-4 text-[12px] font-semibold text-accent hover:text-accent-hover">Open event</button>}</li>)}{visibleSharedEvents.map((event) => <li key={event.id} className="p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><Badge tone="success">Joined</Badge><h2 className="mt-2 text-[15px] font-semibold text-ink">{event.title}</h2><p className="mt-3 flex flex-wrap gap-4 text-[11.5px] text-muted"><span className="inline-flex items-center gap-1.5"><CalendarIcon className="h-3.5 w-3.5" />{new Date(event.startsAt).toLocaleString()}</span><span className="inline-flex items-center gap-1.5"><MapPinIcon className="h-3.5 w-3.5" />{event.venue || "Location to be announced"}</span></p></div><Button size="sm" variant="secondary" onClick={() => void openUrl(`https://eventmanager-5dsz.vercel.app/events/${event.id}`)}>Open event</Button></div></li>)}</ul></Section> : <Section bodyClassName="p-0"><EmptyState icon={<MailIcon className="h-5 w-5" />} title={active === "accepted" ? "Nothing accepted yet" : active === "declined" ? "No declined invitations" : "No invitations waiting"} description={active === "pending" ? "Invitations sent to your paired account will appear here. To join someone else's event, ask its organiser to invite this account." : active === "accepted" ? "Invitations you accept appear here and on the website." : "Invitations you decline are kept here for reference."} /></Section>}
  </div>;
}
