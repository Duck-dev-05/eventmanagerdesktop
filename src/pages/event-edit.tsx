"use client";

import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../App";
import { api } from "../lib/api";
import type { EventRecord } from "../types";
import {
  Alert,
  Button,
  Input,
  PageHeader,
  Section,
  Select,
  Skeleton,
  Textarea,
} from "../components/ui";
import {
  CalendarIcon,
  ChevronRightIcon,
  MapPinIcon,
  Trash2Icon,
} from "../components/icons";

const eventCategories = [
  "Conference",
  "Workshop",
  "Meetup",
  "Webinar",
  "Party",
  "Other",
];

function toLocalDateTimeFields(value: string) {
  const date = new Date(value);
  return {
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    time: `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
  };
}

export function EventEditPage() {
  const { eventId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [event, setEvent] = useState<EventRecord | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Conference");
  const [venue, setVenue] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [capacity, setCapacity] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!eventId || !user) return;
    Promise.all([
      api.getEvent(eventId, user.id),
      api.listEventMembers(eventId, user.id),
      api.listSyncedEventMembers(eventId, user.id),
    ]).then(([result, localMembers, syncedMembers]) => {
      if (result.success && result.data) {
        const record = result.data;
        const role = [...(localMembers.data ?? []), ...(syncedMembers.data ?? [])]
          .find((member) => member.userId === user.id && member.status === "accepted")?.role;
        if (record.ownerId !== user.id && role !== "admin") {
          navigate(`/events/${eventId}`);
          setLoading(false);
          return;
        }
        setEvent(record);
        setTitle(record.title);
        setDescription(record.description);
        setCategory(record.category);
        setVenue(record.venue);
        const localStart = toLocalDateTimeFields(record.startsAt);
        setDate(localStart.date);
        setTime(localStart.time);
        setCapacity(record.capacity ? String(record.capacity) : "");
        setVisibility(record.visibility);
      }
      setLoading(false);
    });
  }, [eventId, navigate, user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const stayOnPage = submitter?.value === "stay";
    if (!user || !event || !eventId) return;

    if (title.trim().length < 3) {
      setError("Give your event a title of at least 3 characters.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Choose the date your event takes place.");
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(time)) {
      setError("Choose a start time for your event.");
      return;
    }

    const startsAt = new Date(`${date}T${time}`);
    if (Number.isNaN(startsAt.getTime())) {
      setError("That date and time could not be read. Try again.");
      return;
    }

    let cap: number | null = null;
    if (capacity) {
      const parsed = Number(capacity);
      if (!Number.isInteger(parsed) || parsed < 1) {
        setError("Capacity must be a whole number above 0.");
        return;
      }
      cap = parsed;
    }

    setSaving(true);
    try {
      const result = await api.updateEvent(eventId, user.id, {
        title,
        description,
        category,
        venue,
        startsAt: startsAt.toISOString(),
        capacity: cap,
        visibility,
      });
      if (result.success) {
        if (!stayOnPage) navigate(`/events/${eventId}`);
      } else {
        setError(result.error || "Failed to update event");
      }
    } catch (err: any) {
      setError(err.message || "Failed to update event");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!user || !event) return;
    if (!confirm("Are you sure you want to delete this event?")) return;
    try {
      const result = await api.deleteEvent(event.id, user.id);
      if (result.success) {
        navigate("/my-events");
      } else {
        setError(result.error || "Failed to delete event");
      }
    } catch (err: any) {
      setError(err.message || "Failed to delete event");
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-48" />
        </div>
        <Skeleton className="h-[300px] rounded-2xl" />
      </div>
    );
  }

  if (!event) {
    return <p className="text-[12.5px] text-muted">Event not found.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Events"
        title="Edit event"
        description={`Update the details for “${event.title}”.`}
        actions={
          <Button variant="ghost" onClick={() => navigate(`/events/${eventId}`)}>
            Back to event <ChevronRightIcon className="h-3.5 w-3.5" />
          </Button>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start"
      >
        <div className="space-y-5">
          <Section
            title="Event details"
            description="What the event is about"
            icon={<CalendarIcon className="h-4 w-4" />}
          >
            <div className="space-y-4">
              <Input
                id="title"
                label="Event title"
                value={title}
                onChange={(e) => setTitle(e.currentTarget.value)}
                required
              />
              <Textarea
                id="description"
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.currentTarget.value)}
                required
              />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Select
                  id="category"
                  label="Category"
                  value={category}
                  onChange={(e) => setCategory(e.currentTarget.value)}
                >
                  {eventCategories.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
                <Select
                  id="visibility"
                  label="Visibility"
                  value={visibility}
                  onChange={(e) => setVisibility(e.currentTarget.value)}
                >
                  <option value="private">Private (members only)</option>
                  <option value="public">Public (workspace read-only)</option>
                </Select>
              </div>
            </div>
          </Section>

          <Section
            title="Schedule & venue"
            description="When and where it happens"
            icon={<MapPinIcon className="h-4 w-4" />}
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Input
                  id="date"
                  label="Date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.currentTarget.value)}
                  required
                />
                <Input
                  id="time"
                  label="Start time"
                  type="time"
                  value={time}
                  onChange={(e) => setTime(e.currentTarget.value)}
                  required
                />
                <Input
                  id="capacity"
                  label="Capacity"
                  type="number"
                  value={capacity}
                  onChange={(e) => setCapacity(e.currentTarget.value)}
                  placeholder="Unlimited"
                  hint="Optional"
                />
              </div>
              <Input
                id="venue"
                label="Venue"
                value={venue}
                onChange={(e) => setVenue(e.currentTarget.value)}
              />
            </div>
          </Section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <Section title="Actions" bodyClassName="p-4">
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={() => formRef.current?.requestSubmit()}
                disabled={saving}
              >
                {saving ? "Saving..." : "Save changes"}
              </Button>
              <Button
                type="submit"
                value="stay"
                variant="secondary"
                className="w-full"
                disabled={saving}
              >
                Save and stay
              </Button>
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => navigate(`/events/${eventId}`)}
              >
                Discard changes
              </Button>
            </div>

            {user && event.ownerId === user.id && (
              <div className="mt-4 border-t border-line-soft pt-3">
                <p className="mb-2 text-[11px] leading-relaxed text-faint">
                  Deleting an event removes it for every collaborator.
                </p>
                <Button
                  variant="danger"
                  className="w-full"
                  onClick={handleDelete}
                >
                  <Trash2Icon className="h-4 w-4" /> Delete event
                </Button>
              </div>
            )}
          </Section>

          <p className="px-1 text-[11px] leading-relaxed text-faint">
            Created{" "}
            {new Date(event.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </aside>
      </form>
    </div>
  );
}
