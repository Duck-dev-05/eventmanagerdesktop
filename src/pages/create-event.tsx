"use client";

import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../App";
import { api } from "../lib/api";
import {
  Alert,
  Button,
  Input,
  PageHeader,
  Section,
  Select,
  Textarea,
} from "../components/ui";
import { CalendarIcon, ChevronRightIcon, MapPinIcon } from "../components/icons";

const eventCategories = [
  "Conference",
  "Workshop",
  "Meetup",
  "Webinar",
  "Party",
  "Other",
];

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-[11px] text-muted">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[12px] font-semibold text-ink">
        {value}
      </dd>
    </div>
  );
}

export function CreateEventPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Conference");
  const [venue, setVenue] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [capacity, setCapacity] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [template, setTemplate] = useState<import("../types").Template | null>(null);
  const [defaultCapacity, setDefaultCapacity] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    api.getPreferences(user.id).then((result) => {
      const capacity = result.data?.defaultCapacity ?? null;
      setDefaultCapacity(capacity);
      if (!searchParams.get("templateId")) setCapacity(capacity ? String(capacity) : "");
    });
  }, [user, searchParams]);

  useEffect(() => {
    const templateId = searchParams.get("templateId");
    if (!templateId || !user) return;
    Promise.all([api.listTemplates(user.id), api.getPreferences(user.id)]).then(([result, preferenceResult]) => {
      const capacity = preferenceResult.data?.defaultCapacity ?? null;
      setDefaultCapacity(capacity);
      const selected = result.data?.find((item) => item.id === templateId);
      if (!selected) return;
      setTemplate(selected);
      setTitle(selected.name);
      setDescription(selected.description);
      setCategory(selected.category);
      setVenue(selected.defaultVenue);
      setCapacity(selected.defaultCapacity?.toString() ?? (capacity ? String(capacity) : ""));
    });
  }, [searchParams, user]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!user) return;

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

    setLoading(true);
    try {
      const result = await api.createEvent(user.id, {
        title,
        description,
        category,
        venue,
        startsAt: startsAt.toISOString(),
        capacity: cap,
      });
      if (result.success && result.data) {
        if (template) {
          let offsetMinutes = 0;
          for (const preset of template.agendaPresets ?? []) {
            const item = preset as { title?: string; description?: string; durationMinutes?: number };
            const itemDuration = Math.max(5, Number(item.durationMinutes) || 30);
            await api.saveAgendaItem({
              eventId: result.data.id, actorId: user.id, itemId: null,
              title: item.title || "Agenda session", description: item.description || "",
              startsAt: new Date(startsAt.getTime() + offsetMinutes * 60_000).toISOString(),
              durationMinutes: itemDuration, location: venue, speakerName: "", status: "scheduled",
            });
            offsetMinutes += itemDuration;
          }
          for (const preset of template.taskPresets ?? []) {
            const item = preset as { title?: string; notes?: string };
            await api.createEventTask(result.data.id, user.id, item.title || "Event task", item.notes || "", null);
          }
        }
        navigate(`/events/${result.data.id}`);
      } else {
        setError(result.error || "Failed to create event");
      }
    } catch (err: any) {
      setError(err.message || "Failed to create event");
    } finally {
      setLoading(false);
    }
  }

  const summaryDate =
    date && time
      ? new Date(`${date}T${time}`).toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "Not set";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Events"
        title="Create event"
        description="Set up the essentials now — you can fine-tune details later."
        actions={
          <Button variant="secondary" onClick={() => navigate("/my-events")}>
            My events <ChevronRightIcon className="h-3.5 w-3.5" />
          </Button>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}

      <form
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
                placeholder="e.g. Tech Innovation Conference"
                required
              />
              <Textarea
                id="description"
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.currentTarget.value)}
                placeholder="What is this event about?"
              />
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
                placeholder="e.g. Grand Convention Center"
              />
            </div>
          </Section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-6">
          <Section title="Summary" bodyClassName="p-5">
            <dl className="divide-y divide-line-soft">
              <SummaryRow label="Title" value={title || "Untitled event"} />
              <SummaryRow label="Category" value={category} />
              <SummaryRow label="Starts" value={summaryDate} />
              <SummaryRow label="Venue" value={venue || "To be announced"} />
              <SummaryRow
                label="Capacity"
                value={capacity ? `${capacity} guests` : "Unlimited"}
              />
            </dl>
          </Section>

          <div className="space-y-2">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Creating event..." : "Create event"}
            </Button>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => navigate("/my-events")}
            >
              Cancel
            </Button>
          </div>

          <p className="px-1 text-[11px] leading-relaxed text-faint">
            Events you create are private by default — you can invite teammates
            and change visibility after saving.
          </p>
        </aside>
      </form>
    </div>
  );
}
