"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { api } from "../lib/api";
import type { EventListItem } from "../types";
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  MetaChip,
  PageHeader,
  Section,
  Segmented,
  Skeleton,
} from "../components/ui";
import {
  CalendarIcon,
  ClockIcon,
  MapPinIcon,
  PlusIcon,
  TicketIcon,
} from "../components/icons";

type FilterId = "all" | "upcoming" | "past" | "shared";

const filterOptions: { value: FilterId; label: string }[] = [
  { value: "all", label: "All events" },
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "shared", label: "Shared" },
];

const emptyCopy: Record<
  FilterId,
  { title: string; description: string; canCreate: boolean }
> = {
  all: {
    title: "No events yet",
    description:
      "Events you create will show up here with their date, venue and capacity.",
    canCreate: true,
  },
  upcoming: {
    title: "Nothing upcoming",
    description:
      "You have no future events scheduled. Create one to get the ball rolling.",
    canCreate: true,
  },
  past: {
    title: "No past events",
    description: "Events move here automatically once their start time has passed.",
    canCreate: true,
  },
  shared: {
    title: "No shared events",
    description:
      "When an owner invites you to an event, it will appear here with collaborator access.",
    canCreate: false,
  },
};

export function MyEventsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [filter, setFilter] = useState<FilterId>("all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setLoadError(null);
    api.listEventsFlat(user.id)
      .then((result) => {
        if (!active) return;
        if (result.success && result.data) setEvents(result.data);
        else setLoadError(result.error || "Events could not be loaded.");
      })
      .catch((error) => {
        if (active) setLoadError(String(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user, reload]);

  const visible = events.filter((event) => {
    if (filter === "upcoming") return event.status === "Upcoming";
    if (filter === "past") return event.status === "Past";
    if (filter === "shared") return !event.isOwner;
    return true;
  });

  const counts: Record<FilterId, number> = {
    all: events.length,
    upcoming: events.filter((event) => event.status === "Upcoming").length,
    past: events.filter((event) => event.status === "Past").length,
    shared: events.filter((event) => !event.isOwner).length,
  };

  const empty = emptyCopy[filter];

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-48" />
        </div>
        <Skeleton className="h-10 w-80 rounded-xl" />
        <Skeleton className="h-[320px] rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <Alert tone="danger" className="flex flex-wrap items-center justify-between gap-3">
          <span>Could not load events: {loadError}</span>
          <Button size="sm" variant="secondary" onClick={() => setReload((n) => n + 1)}>
            Retry
          </Button>
        </Alert>
      )}
      <PageHeader
        eyebrow="Workspace"
        title="My events"
        description="Everything you own or collaborate on, with the details that matter."
        actions={
          <Button onClick={() => navigate("/events/new")}>
            <PlusIcon className="h-4 w-4" /> Create event
          </Button>
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          options={filterOptions.map((option) => ({
            ...option,
            count: counts[option.value],
          }))}
          value={filter}
          onChange={setFilter}
        />
        <p className="text-[11.5px] font-medium text-muted">
          Showing {visible.length} of {events.length}
        </p>
      </div>

      <Section bodyClassName="p-0">
        {visible.length === 0 ? (
          <EmptyState
            title={empty.title}
            description={empty.description}
            icon={<CalendarIcon className="h-5 w-5" />}
            action={
              empty.canCreate ? (
                <Button onClick={() => navigate("/events/new")}>
                  <PlusIcon className="h-4 w-4" /> Create event
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line-soft">
            {visible.map((event) => (
              <li
                key={event.id}
                className="group flex flex-col gap-4 px-4 py-4 transition-colors hover:bg-raised sm:flex-row sm:items-center sm:px-5"
              >
                <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border border-line bg-sunken transition-colors group-hover:border-accent-line group-hover:bg-accent-soft">
                  <span className="font-mono text-[8.5px] font-semibold uppercase tracking-eyebrow text-accent">
                    {event.month}
                  </span>
                  <span className="text-[16px] font-semibold leading-none text-ink">
                    {event.day}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/events/${event.id}`)}
                      className="max-w-full truncate text-left text-[13.5px] font-semibold text-ink transition-colors hover:text-accent"
                    >
                      {event.title}
                    </button>
                    {!event.isOwner && <Badge tone="info">Shared</Badge>}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <MetaChip icon={<ClockIcon className="h-3 w-3" />}>
                      {event.time}
                    </MetaChip>
                    <MetaChip icon={<MapPinIcon className="h-3 w-3" />}>
                      {event.venue || "Location TBD"}
                    </MetaChip>
                    <MetaChip icon={<TicketIcon className="h-3 w-3" />}>
                      {event.capacity ? `${event.capacity} capacity` : "Unlimited"}
                    </MetaChip>
                  </div>
                </div>

                <div className="flex items-center gap-2.5">
                  <Badge tone={event.status === "Upcoming" ? "success" : "neutral"}>
                    {event.status}
                  </Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => navigate(`/events/${event.id}`)}
                  >
                    Open
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
