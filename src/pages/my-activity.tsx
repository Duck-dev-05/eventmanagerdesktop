"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { api } from "../lib/api";
import type { ActivityEntry } from "../types";
import { Alert, Button, EmptyState, PageHeader, Section, Skeleton } from "../components/ui";
import { CalendarIcon, ChevronRightIcon, PulseIcon } from "../components/icons";

type ActivityItem = ActivityEntry & { eventTitle: string; eventId: string };

export function MyActivityPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    api.listEvents(user.id).then(async (result) => {
      if (!active) return;
      if (!result.success || !result.data) {
        setError(result.error || "Activity could not be loaded.");
        return;
      }
      const eventActivity = await Promise.all(result.data.map(async (event) => {
        const entries = await api.getEventActivity(event.id, user.id);
        return (entries.success ? entries.data ?? [] : []).map((entry) => ({ ...entry, eventId: event.id, eventTitle: event.title }));
      }));
      if (active) setActivity(eventActivity.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }).catch((reason) => { if (active) setError(String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user, reload]);

  return <div className="space-y-6">
    <PageHeader eyebrow="Insights" title="My Activity" description="A running log of events you create and events shared with you." />
    {error && <Alert tone="danger" className="flex items-center justify-between gap-3"><span>{error}</span><Button size="sm" variant="secondary" onClick={() => { setError(null); setReload((value) => value + 1); }}>Retry</Button></Alert>}
    {loading ? <Skeleton className="h-[340px]" /> : <Section title="Recent activity" description="Based on events currently available in this desktop workspace." icon={<PulseIcon className="h-4 w-4" />} bodyClassName="p-0">
      {activity.length === 0 ? <EmptyState title="No activity yet" description="Create an event or join one to see activity here." icon={<PulseIcon className="h-5 w-5" />} /> : <ol className="divide-y divide-line-soft">{activity.map((item) => <li key={item.id}><button type="button" onClick={() => navigate(`/events/${item.eventId}`)} className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-raised"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><CalendarIcon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-semibold text-ink">{item.summary} · {item.eventTitle}</span><time className="mt-1 block text-[11px] text-muted">{new Date(item.createdAt).toLocaleString()}</time></span><ChevronRightIcon className="h-4 w-4 text-faint" /></button></li>)}</ol>}
    </Section>}
  </div>;
}
