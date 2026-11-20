import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../App";
import { api } from "../lib/api";
import type { AgendaItem, EventRecord, EventTask, SyncedEventMember } from "../types";
import { Alert, Button, Skeleton } from "../components/ui";
import { CalendarIcon, ChevronLeftIcon, ClockIcon, MapPinIcon, UsersIcon } from "../components/icons";

export function PrintEventPage() {
  const { eventId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [agenda, setAgenda] = useState<AgendaItem[]>([]);
  const [tasks, setTasks] = useState<EventTask[]>([]);
  const [members, setMembers] = useState<SyncedEventMember[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!eventId || !user) return;
    Promise.all([
      api.getEvent(eventId, user.id),
      api.listAgendaItems(eventId, user.id),
      api.listEventTasks(eventId, user.id),
      api.listSyncedEventMembers(eventId, user.id),
    ]).then(([eventResult, agendaResult, taskResult, memberResult]) => {
      if (!eventResult.success || !eventResult.data) {
        setError(eventResult.error || "Event not found.");
        return;
      }
      if (!agendaResult.success || !taskResult.success) {
        setError("You need event access to view its run sheet.");
        return;
      }
      setEvent(eventResult.data);
      if (agendaResult.success && agendaResult.data) setAgenda(agendaResult.data);
      if (taskResult.success && taskResult.data) setTasks(taskResult.data);
      if (memberResult.success && memberResult.data) setMembers(memberResult.data.filter((member) => member.status === "accepted"));
    }).catch((reason) => setError(String(reason)));
  }, [eventId, user?.id]);

  if (error) return <Alert tone="danger">{error}</Alert>;
  if (!event) return <div className="space-y-4"><Skeleton className="h-16"/><Skeleton className="h-96"/></div>;

  const printDate = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  const completed = tasks.filter((task) => task.status === "done").length;

  return <div className="run-sheet mx-auto max-w-4xl space-y-5 print:max-w-none print:space-y-5">
    <style>{`@media print { body * { visibility: hidden !important; } .run-sheet, .run-sheet * { visibility: visible !important; } .run-sheet { position: absolute; inset: 0; width: 100%; max-width: none; padding: 24px; background: white; color: #18181b; } .no-print { display: none !important; } }`}</style>
    <div className="no-print flex items-center justify-between"><Button variant="secondary" onClick={() => navigate(`/events/${event.id}`)}><ChevronLeftIcon className="h-4 w-4"/>Back to event</Button><Button onClick={() => window.print()}>Print run sheet</Button></div>
    <article className="space-y-6 rounded-2xl border border-line bg-white p-6 shadow-panel print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-9">
      <header className="border-b border-line-soft pb-5">
        <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-accent"><CalendarIcon className="h-4 w-4"/>EventPulse · Run sheet</div><span className="text-[11px] text-muted">Generated {printDate}</span></div>
        <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink">{event.title}</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{event.description || "No event briefing provided."}</p>
        <dl className="mt-5 grid gap-4 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="font-semibold text-muted">Date & time</dt><dd className="mt-1 flex items-center gap-1.5 text-ink"><ClockIcon className="h-3.5 w-3.5"/>{new Date(event.startsAt).toLocaleString()}</dd></div>
          <div><dt className="font-semibold text-muted">Venue</dt><dd className="mt-1 flex items-center gap-1.5 text-ink"><MapPinIcon className="h-3.5 w-3.5"/>{event.venue || "To be announced"}</dd></div>
          <div><dt className="font-semibold text-muted">Capacity</dt><dd className="mt-1 flex items-center gap-1.5 text-ink"><UsersIcon className="h-3.5 w-3.5"/>{event.capacity ? `${event.capacity} guests` : "Unlimited"}</dd></div>
          <div><dt className="font-semibold text-muted">Checklist</dt><dd className="mt-1 text-ink">{completed} of {tasks.length} complete</dd></div>
        </dl>
      </header>
      <section className="space-y-3">
        <h2 className="border-b border-line-soft pb-2 text-sm font-bold uppercase tracking-wider text-ink">Schedule · {agenda.length} sessions</h2>
        {agenda.length ? <ol className="divide-y divide-line-soft">{agenda.map((item) => <li key={item.id} className="grid gap-2 py-3 sm:grid-cols-[150px_1fr_auto]"><time className="text-[12px] font-semibold text-accent">{new Date(item.startsAt).toLocaleString()}<span className="block text-[10px] font-normal text-muted">{item.durationMinutes} min</span></time><div><p className="text-[13px] font-semibold text-ink">{item.title}</p>{item.description && <p className="mt-1 text-[11.5px] text-muted">{item.description}</p>}<p className="mt-1 text-[10.5px] text-muted">{[item.location, item.speakerName].filter(Boolean).join(" · ")}</p></div><span className="text-[10px] font-semibold uppercase text-muted">{item.status}</span></li>)}</ol> : <p className="text-[12px] text-muted">No sessions scheduled.</p>}
      </section>
      <section className="space-y-3">
        <h2 className="border-b border-line-soft pb-2 text-sm font-bold uppercase tracking-wider text-ink">Team · {members.length} members</h2>
        {members.length ? <ul className="grid gap-2 sm:grid-cols-2">{members.map((member) => <li key={member.id} className="rounded-lg border border-line-soft p-3"><p className="text-[12px] font-semibold text-ink">{member.name}</p><p className="text-[10.5px] text-muted">{member.email} · {member.role}</p></li>)}</ul> : <p className="text-[12px] text-muted">No synced team contacts available.</p>}
      </section>
      <section className="space-y-3">
        <h2 className="border-b border-line-soft pb-2 text-sm font-bold uppercase tracking-wider text-ink">Operations checklist · {completed}/{tasks.length}</h2>
        {tasks.length ? <ul className="divide-y divide-line-soft">{tasks.map((task) => <li key={task.id} className="flex items-start gap-3 py-2.5"><span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-line-strong">{task.status === "done" ? "✓" : ""}</span><div><p className={`text-[12px] font-medium ${task.status === "done" ? "text-muted line-through" : "text-ink"}`}>{task.title}</p>{task.notes && <p className="mt-0.5 text-[10.5px] text-muted">{task.notes}</p>}</div></li>)}</ul> : <p className="text-[12px] text-muted">No tasks on the checklist.</p>}
      </section>
      <section><h2 className="border-b border-line-soft pb-2 text-sm font-bold uppercase tracking-wider text-ink">Day-of notes</h2><div className="mt-4 space-y-7"><div className="h-px bg-line-soft"/><div className="h-px bg-line-soft"/><div className="h-px bg-line-soft"/></div></section>
    </article>
  </div>;
}
