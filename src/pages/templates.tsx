"use client";

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { api } from "../lib/api";
import type { Template } from "../types";
import {
  Badge,
  Button,
  EmptyState,
  Alert,
  Input,
  PageHeader,
  Section,
  Select,
  Skeleton,
  Textarea,
} from "../components/ui";
import { ColumnsIcon, PlusIcon } from "../components/icons";

export function TemplatesPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("Conference");
  const [description, setDescription] = useState("");
  const [venue, setVenue] = useState("");
  const [capacity, setCapacity] = useState("");
  const [duration, setDuration] = useState("180");
  const [agendaText, setAgendaText] = useState("");
  const [taskText, setTaskText] = useState("");

  useEffect(() => {
    if (!user) return;
    api.listTemplates(user.id).then((result) => {
      if (result.success && result.data) setTemplates(result.data);
      else setError(result.error || "Could not load templates.");
    }).catch((reason) => setError(String(reason))).finally(() => setLoading(false));
  }, [user]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-3">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-40" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-[230px] rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!user) {
    return <p className="text-[12.5px] text-muted">No templates available.</p>;
  }
  const currentUser = user;

  async function saveTemplate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setSaving(true); setError("");
    const parsedCapacity = capacity ? Number(capacity) : null;
    const parsedDuration = Number(duration);
    if (parsedCapacity !== null && (!Number.isInteger(parsedCapacity) || parsedCapacity < 1 || parsedCapacity > 100000)) {
      setError("Capacity must be a whole number between 1 and 100,000."); setSaving(false); return;
    }
    if (!Number.isInteger(parsedDuration) || parsedDuration < 15 || parsedDuration > 1440) {
      setError("Duration must be between 15 and 1,440 minutes."); setSaving(false); return;
    }
    const agendaPresets = agendaText.split("\n").map((line) => line.trim()).filter(Boolean).map((title) => ({ title, description: "", durationMinutes: 30 }));
    const taskPresets = taskText.split("\n").map((line) => line.trim()).filter(Boolean).map((title) => ({ title, notes: "" }));
    try {
      const result = await api.createTemplate(currentUser.id, { name, category, description, defaultVenue: venue, defaultCapacity: parsedCapacity, defaultDurationMinutes: parsedDuration, agendaPresets, taskPresets });
      if (result.success && result.data) {
        setTemplates((previous) => [result.data!, ...previous]); setShowCreate(false); setName(""); setDescription(""); setVenue(""); setCapacity(""); setAgendaText(""); setTaskText("");
      } else setError(result.error || "Could not create template.");
    } catch (reason) { setError(String(reason)); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Organize"
        title="Templates"
        description="Reusable structures for the events you run most often."
        actions={
          <><Button variant="secondary" onClick={() => { setShowCreate((value) => !value); setError(""); }}><PlusIcon className="h-4 w-4" /> Create template</Button><Button onClick={() => navigate("/events/new")}><PlusIcon className="h-4 w-4" /> New event</Button></>
        }
      />

      {error && <Alert tone="danger">{error}</Alert>}
      {showCreate && <Section title="Create a reusable template" description="Preset items are one per line." className="mb-5"><form onSubmit={(e) => void saveTemplate(e)} className="grid gap-4 sm:grid-cols-2">
        <Input id="template-name" label="Template name" value={name} onChange={(e) => setName(e.currentTarget.value)} required maxLength={100} />
        <Select id="template-category" label="Category" value={category} onChange={(e) => setCategory(e.currentTarget.value)}>{["Conference","Workshop","Meetup","Webinar","Party","Other"].map((option) => <option key={option}>{option}</option>)}</Select>
        <div className="sm:col-span-2"><Textarea id="template-description" label="Description" value={description} onChange={(e) => setDescription(e.currentTarget.value)} rows={2} /></div>
        <Input id="template-venue" label="Default venue" value={venue} onChange={(e) => setVenue(e.currentTarget.value)} />
        <Input id="template-capacity" label="Default capacity" type="number" min="1" value={capacity} onChange={(e) => setCapacity(e.currentTarget.value)} />
        <Input id="template-duration" label="Default event duration (minutes)" type="number" min="15" max="1440" value={duration} onChange={(e) => setDuration(e.currentTarget.value)} />
        <div className="sm:col-span-2"><Textarea id="template-agenda" label="Agenda presets (one session per line)" value={agendaText} onChange={(e) => setAgendaText(e.currentTarget.value)} rows={4} /></div>
        <div className="sm:col-span-2"><Textarea id="template-tasks" label="Task presets (one task per line)" value={taskText} onChange={(e) => setTaskText(e.currentTarget.value)} rows={4} /></div>
        <div className="sm:col-span-2 flex justify-end gap-2"><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save template"}</Button><Button type="button" variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button></div>
      </form></Section>}

      {templates.length === 0 ? (
        <div className="rounded-2xl border border-line bg-panel shadow-panel">
          <EmptyState
            title="No templates yet"
            description="Templates let you start from a ready-made agenda and task list."
            icon={<ColumnsIcon className="h-5 w-5" />}
            action={
              <Button onClick={() => navigate("/events/new")}>
                <PlusIcon className="h-4 w-4" /> Create event
              </Button>
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <article
              key={template.id}
              className="group flex flex-col rounded-2xl border border-line bg-panel shadow-panel transition-all duration-200 hover:-translate-y-0.5 hover:shadow-card"
            >
              {/* Card header: icon badge + category badge */}
              <div className="flex items-start justify-between gap-3 p-5 pb-0">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent ring-1 ring-inset ring-accent-line/50 transition-colors group-hover:bg-accent group-hover:text-white group-hover:ring-accent">
                  <ColumnsIcon className="h-4.5 w-4.5 h-[18px] w-[18px]" />
                </div>
                <Badge tone="accent">{template.category}</Badge>
              </div>

              {/* Card body: title + description */}
              <div className="flex-1 px-5 pt-3.5">
                <h3 className="text-[14.5px] font-semibold leading-snug tracking-tight text-ink">
                  {template.name}
                </h3>
                <p className="mt-1.5 line-clamp-3 text-[12px] leading-relaxed text-muted">
                  {template.description}
                </p>
              </div>

              {/* Card footer: preset counts */}
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft px-5 py-3 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1 font-medium">
                  <span className="font-semibold text-ink-soft">
                    {template.agendaPresets?.length ?? 0}
                  </span>{" "}
                  agenda items
                </span>
                <span className="text-line-strong">·</span>
                <span className="inline-flex items-center gap-1 font-medium">
                  <span className="font-semibold text-ink-soft">
                    {template.taskPresets?.length ?? 0}
                  </span>{" "}
                  tasks
                </span>
                {template.defaultDurationMinutes ? (
                  <>
                    <span className="text-line-strong">·</span>
                    <span className="font-medium">
                      {template.defaultDurationMinutes} min
                    </span>
                  </>
                ) : null}
              </div>

              {/* Full-width use button */}
              <div className="px-5 pb-5">
                <Button
                  variant="secondary"
                  size="sm"
                  className="w-full transition-all group-hover:border-accent-line group-hover:bg-accent-soft group-hover:text-accent"
                  onClick={() =>
                    navigate(`/events/new?templateId=${template.id}`)
                  }
                >
                  Use template
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
