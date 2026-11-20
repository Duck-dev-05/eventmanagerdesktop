"use client";

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../App";
import { api } from "../lib/api";
import type { EventRecord } from "../types";
import { Alert, Button, PageHeader, Skeleton } from "../components/ui";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, ClockIcon, MapPinIcon, PlusIcon } from "../components/icons";

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const monthFormatter = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
function monthKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; }
function parseMonth(value: string | null) {
  const match = value?.match(/^(\d{4})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]) - 1;
    if (year >= 2000 && year <= 2100 && month >= 0 && month <= 11) return new Date(year, month, 1);
  }
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

export function CalendarPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const first = parseMonth(searchParams.get("month"));
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    api.listEvents(user.id).then((result) => {
      if (!active) return;
      if (result.success && result.data) setEvents(result.data);
      else setError(result.error || "Events could not be loaded.");
    }).catch((reason) => { if (active) setError(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user]);

  const year = first.getFullYear();
  const month = first.getMonth();
  const monthEvents = useMemo(() => events
    .filter((event) => {
      const date = new Date(event.startsAt);
      return date.getFullYear() === year && date.getMonth() === month;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [events, month, year]);
  const byDay = new Map<number, EventRecord[]>();
  for (const event of monthEvents) {
    const day = new Date(event.startsAt).getDate();
    byDay.set(day, [...(byDay.get(day) ?? []), event]);
  }
  const leading = first.getDay();
  const totalCells = Math.ceil((leading + new Date(year, month + 1, 0).getDate()) / 7) * 7;
  const today = new Date();
  const cells = Array.from({ length: totalCells }, (_, index) => {
    const date = new Date(year, month, index - leading + 1);
    const inMonth = date.getMonth() === month;
    return { index, date, inMonth, isToday: inMonth && date.toDateString() === today.toDateString(), events: inMonth ? byDay.get(date.getDate()) ?? [] : [] };
  });
  const goMonth = (date: Date) => setSearchParams({ month: monthKey(date) });

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Workspace" title="Calendar" description="See your events by month and open an event for details." actions={<Button onClick={() => navigate("/events/new")}><PlusIcon className="h-4 w-4" /> Add event</Button>} />
      {error && <Alert tone="danger">{error}</Alert>}
      {loading ? <Skeleton className="h-[560px]" /> : (
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,0.8fr)]">
          <section className="overflow-hidden rounded-2xl border border-line bg-panel shadow-panel">
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div><h2 className="text-[16px] font-semibold text-ink">{monthFormatter.format(first)}</h2><p className="mt-0.5 text-[12px] text-muted">{monthEvents.length ? `${monthEvents.length} event${monthEvents.length === 1 ? "" : "s"} scheduled` : "Nothing scheduled this month"}</p></div>
              <div className="flex items-center gap-1.5">
                <Button variant="secondary" size="sm" onClick={() => goMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</Button>
                <Button variant="secondary" size="sm" onClick={() => goMonth(new Date(year, month - 1, 1))} aria-label="Previous month"><ChevronLeftIcon className="h-4 w-4" /></Button>
                <Button variant="secondary" size="sm" onClick={() => goMonth(new Date(year, month + 1, 1))} aria-label="Next month"><ChevronRightIcon className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="grid grid-cols-7 border-y border-line-soft bg-sunken/70">{weekdays.map((day) => <div key={day} className="py-2 text-center font-mono text-[9px] font-semibold uppercase tracking-wider text-muted">{day}</div>)}</div>
            <div className="grid grid-cols-7 gap-px bg-line-soft">
              {cells.map((cell) => <div key={cell.index} className={`min-h-[100px] min-w-0 p-1.5 sm:p-2 ${cell.inMonth ? "bg-panel" : "bg-sunken/60"}`}>
                <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] ${cell.isToday ? "bg-accent text-white" : cell.inMonth ? "text-ink-soft" : "text-faint"}`}>{cell.date.getDate()}</span>
                <div className="mt-1 space-y-1">{cell.events.map((event) => <button key={event.id} type="button" onClick={() => navigate(`/events/${event.id}`)} title={event.title} className="block w-full truncate rounded-md bg-accent-soft px-1.5 py-1 text-left text-[10px] font-medium text-accent-ink hover:bg-accent-line">{new Date(event.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} {event.title}</button>)}</div>
              </div>)}
            </div>
          </section>
          <section className="rounded-2xl border border-line bg-panel p-5 shadow-panel">
            <div className="flex items-center justify-between gap-2"><h2 className="text-[15px] font-semibold text-ink">Agenda</h2><span className="rounded-full bg-sunken px-2.5 py-1 text-[10.5px] font-semibold text-muted">{monthFormatter.format(first)}</span></div>
            {monthEvents.length === 0 ? <div className="mt-4 rounded-xl border border-dashed border-line px-4 py-10 text-center"><CalendarIcon className="mx-auto h-7 w-7 text-faint" /><p className="mt-3 text-[12.5px] font-medium text-ink">Nothing scheduled this month</p><p className="mt-1 text-[11.5px] text-muted">Create an event or browse another month.</p></div> : <ul className="mt-4 space-y-2">{monthEvents.map((event) => <li key={event.id}><button type="button" onClick={() => navigate(`/events/${event.id}`)} className="flex w-full items-start gap-3 rounded-xl border border-line-soft p-3 text-left hover:border-accent-line hover:bg-accent-soft/40"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[12px] font-semibold text-accent">{new Date(event.startsAt).getDate()}</span><span className="min-w-0"><span className="block truncate text-[12.5px] font-semibold text-ink">{event.title}</span><span className="mt-1 flex flex-wrap gap-x-2 text-[10.5px] text-muted"><span className="inline-flex items-center gap-1"><ClockIcon className="h-3 w-3" />{new Date(event.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span><span className="inline-flex items-center gap-1"><MapPinIcon className="h-3 w-3" />{event.venue || "Location TBD"}</span></span></span></button></li>)}</ul>}
          </section>
        </div>
      )}
    </div>
  );
}
