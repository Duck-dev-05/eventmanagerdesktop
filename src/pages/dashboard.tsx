"use client";

import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { api } from "../lib/api";
import type { EventRecord } from "../types";
import { Alert, Badge, Button, EmptyState, MetaChip, Section, Skeleton } from "../components/ui";
import {
  ArrowRightIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  GridIcon,
  MapPinIcon,
  PlusIcon,
  TicketIcon,
  UsersIcon,
} from "../components/icons";

function formatDate(dateString: string) {
  return new Date(dateString).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function getTodayLabel() {
  return new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    api.listEvents(user.id)
      .then((result) => {
        if (!active) return;
        if (result.success && result.data) setEvents(result.data);
        else setLoadError(result.error || "Events could not be loaded.");
      })
      .catch((error) => { if (active) setLoadError(String(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, reload]);

  const now = Date.now();
  const upcoming = events.filter((event) => new Date(event.startsAt).getTime() >= now)
    .sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const pastCount = events.length - upcoming.length;
  const shared = events.filter((event) => event.ownerId !== user?.id);
  const nextEvent = upcoming[0];
  const daysUntilNext = nextEvent ? Math.max(0, Math.ceil((new Date(nextEvent.startsAt).getTime() - now) / 86_400_000)) : null;
  const firstName = user?.name?.split(" ")[0];

  if (loading) {
    return <div className="space-y-6"><div className="space-y-3"><Skeleton className="h-3 w-24" /><Skeleton className="h-8 w-56" /></div><Skeleton className="h-[230px] rounded-[26px]" /><Skeleton className="h-[110px] rounded-2xl" /><div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.85fr)]"><Skeleton className="h-[340px] rounded-2xl" /><Skeleton className="h-[340px] rounded-2xl" /></div></div>;
  }

  const stats = [
    { label: "Total events", value: events.length, note: "In your workspace", Icon: CalendarIcon, tint: "bg-[#f0efff] text-[#6558d3]" },
    { label: "Upcoming", value: upcoming.length, note: nextEvent ? `Next · ${formatDate(nextEvent.startsAt)}` : "Nothing scheduled", Icon: ClockIcon, tint: "bg-[#eaf8f3] text-[#218364]" },
    { label: "Past events", value: pastCount, note: "Already took place", Icon: CheckCircleIcon, tint: "bg-[#fff4e8] text-[#c17a2e]" },
    { label: "Shared with you", value: shared.length, note: "Team collaborations", Icon: UsersIcon, tint: "bg-[#eef4ff] text-[#5275c9]" },
  ];

  return <div className="space-y-7 sm:space-y-8">
    {loadError && <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-3"><span>Could not load events: {loadError}</span><Button size="sm" variant="secondary" onClick={() => setReload((value) => value + 1)}>Retry</Button></Alert>}

    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7468e8]">{getTodayLabel()}</p>
        <h1 className="mt-2 text-[30px] font-semibold leading-tight tracking-[-0.035em] text-[#20243b] sm:text-[34px]">{firstName ? `Good day, ${firstName}` : "Welcome back"}<span className="ml-2 text-[25px]">✦</span></h1>
        <p className="mt-2 text-[13px] text-[#737a91]">Here’s what’s happening in your event workspace.</p>
      </div>
      <Button onClick={() => navigate("/events/new")}><PlusIcon className="h-4 w-4" /> Plan an event</Button>
    </header>

    <section className="relative overflow-hidden rounded-[26px] bg-[#191d32] px-6 py-7 text-white shadow-[0_22px_60px_-35px_rgba(27,29,58,0.55)] sm:px-8 sm:py-8">
      <div aria-hidden="true" className="pointer-events-none absolute -right-8 -top-24 h-72 w-72 rounded-full bg-[#7468e8]/30 blur-[75px]" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-36 right-1/3 h-64 w-64 rounded-full bg-[#3ca98b]/15 blur-[80px]" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid opacity-[0.08]" />
      <div className="relative flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/45"><span className="h-1.5 w-1.5 rounded-full bg-[#84d8bb]" />Up next</div>
          {nextEvent ? <>
            <h2 className="mt-3 max-w-2xl truncate text-[26px] font-semibold tracking-[-0.03em] sm:text-[30px]">{nextEvent.title}</h2>
            <p className="mt-2 text-[12.5px] text-white/55">Your next event is coming together. Here are the details.</p>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              <MetaChip className="border-white/10 bg-white/[0.07] text-white/80" icon={<CalendarIcon className="h-3 w-3" />}>{formatDate(nextEvent.startsAt)}</MetaChip>
              <MetaChip className="border-white/10 bg-white/[0.07] text-white/80" icon={<ClockIcon className="h-3 w-3" />}>{formatTime(nextEvent.startsAt)}</MetaChip>
              <MetaChip className="border-white/10 bg-white/[0.07] text-white/80" icon={<MapPinIcon className="h-3 w-3" />}>{nextEvent.venue || "Location TBD"}</MetaChip>
            </div>
          </> : <>
            <h2 className="mt-3 text-[25px] font-semibold tracking-tight">A fresh page for something great.</h2>
            <p className="mt-2 max-w-lg text-[13px] leading-relaxed text-white/60">Create your first event and bring your plans, team and schedule together.</p>
          </>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 lg:pl-6">
          {daysUntilNext !== null && <div className="min-w-[90px] rounded-2xl border border-white/10 bg-white/[0.07] px-4 py-3 text-center"><p className="text-[26px] font-semibold leading-none">{daysUntilNext}</p><p className="mt-2 text-[9px] font-semibold uppercase tracking-[0.18em] text-white/50">{daysUntilNext === 1 ? "day away" : "days away"}</p></div>}
          <button type="button" onClick={() => nextEvent ? navigate(`/events/${nextEvent.id}`) : navigate("/events/new")} className="inline-flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-[12.5px] font-semibold text-[#252941] transition-colors hover:bg-[#f0efff]">{nextEvent ? "View event" : "Create first event"}<ArrowRightIcon className="h-4 w-4" /></button>
        </div>
      </div>
    </section>

    <section aria-label="Workspace statistics" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map(({ label, value, note, Icon, tint }) => <div key={label} className="flex min-h-[104px] items-center gap-4 rounded-2xl border border-[#e7e9f2] bg-white p-4 shadow-[0_2px_8px_rgba(31,36,67,0.025)] transition-shadow hover:shadow-[0_12px_30px_-20px_rgba(31,36,67,0.2)] sm:p-5"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] ${tint}`}><Icon className="h-[19px] w-[19px]" /></span><span className="min-w-0"><span className="block text-[24px] font-semibold leading-none tracking-tight text-[#20243b]">{value}</span><span className="mt-1.5 block text-[12px] font-semibold text-[#424961]">{label}</span><span className="mt-0.5 block truncate text-[10.5px] text-[#9096a9]">{note}</span></span></div>)}
    </section>

    <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.85fr)]">
      <Section title="Upcoming events" description="Your next dates at a glance" icon={<CalendarIcon className="h-4 w-4" />} action={<Link to="/my-events" className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#6558d3] hover:text-[#4f43b3]">All events <ArrowRightIcon className="h-3.5 w-3.5" /></Link>} bodyClassName="p-0">
        {upcoming.length === 0 ? <EmptyState title="Nothing on the calendar yet" description="Your upcoming events will appear here once you create one." action={<Button onClick={() => navigate("/events/new")}><PlusIcon className="h-4 w-4" /> Create an event</Button>} /> : <ul className="divide-y divide-[#eef0f6]">{upcoming.slice(0, 5).map((event) => <li key={event.id}><button type="button" onClick={() => navigate(`/events/${event.id}`)} className="group flex w-full items-center gap-3.5 px-4 py-4 text-left transition-colors hover:bg-[#fafaff] sm:px-5"><span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-[14px] bg-[#f2f1ff] text-[#6558d3]"><span className="text-[8px] font-semibold uppercase tracking-[0.15em]">{formatDate(event.startsAt).split(" ")[0]}</span><span className="mt-0.5 text-[17px] font-semibold leading-none">{new Date(event.startsAt).getDate()}</span></span><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><span className="truncate text-[13px] font-semibold text-[#272b43] group-hover:text-[#6558d3]">{event.title}</span><Badge tone={event.ownerId === user?.id ? "accent" : "info"}>{event.ownerId === user?.id ? "Hosting" : "Shared"}</Badge></span><span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#858ba0]"><span className="inline-flex items-center gap-1"><ClockIcon className="h-3 w-3" />{formatTime(event.startsAt)}</span><span className="inline-flex items-center gap-1"><MapPinIcon className="h-3 w-3" />{event.venue || "Location TBD"}</span></span></span><ArrowRightIcon className="h-4 w-4 shrink-0 text-[#b0b5c5] transition-transform group-hover:translate-x-0.5 group-hover:text-[#6558d3]" /></button></li>)}</ul>}
      </Section>

      <div className="space-y-5">
        <Section title="Quick links" description="Jump back into your workspace" icon={<GridIcon className="h-4 w-4" />} bodyClassName="space-y-2 p-3">
          {[
            { href: "/calendar", title: "Calendar", detail: "Browse your schedule", Icon: CalendarIcon },
            { href: "/invitations", title: "Invitations", detail: "See team requests", Icon: UsersIcon },
          ].map(({ href, title, detail, Icon }) => <Link key={href} to={href} className="group flex items-center gap-3 rounded-xl border border-transparent p-3 transition-colors hover:border-[#e7e5fb] hover:bg-[#fafaff]"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f0efff] text-[#6558d3]"><Icon className="h-[18px] w-[18px]" /></span><span className="min-w-0 flex-1"><span className="block text-[12.5px] font-semibold text-[#30354d]">{title}</span><span className="mt-0.5 block text-[11px] text-[#8990a4]">{detail}</span></span><ArrowRightIcon className="h-4 w-4 text-[#b0b5c5] transition-transform group-hover:translate-x-0.5 group-hover:text-[#6558d3]" /></Link>)}
        </Section>
        <section className="overflow-hidden rounded-2xl border border-[#e7e5fb] bg-gradient-to-br from-[#f1efff] via-[#f8f7ff] to-white p-5"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white text-[#6558d3] shadow-sm"><TicketIcon className="h-[18px] w-[18px]" /></span><h2 className="mt-4 text-[14px] font-semibold text-[#292d47]">Make room for good things.</h2><p className="mt-1.5 text-[11.5px] leading-relaxed text-[#727891]">Keep your event details and collaborators together in one calm workspace.</p><Link to="/my-events" className="mt-3 inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#6558d3] hover:text-[#4f43b3]">Explore events <ArrowRightIcon className="h-3.5 w-3.5" /></Link></section>
      </div>
    </div>
  </div>;
}
