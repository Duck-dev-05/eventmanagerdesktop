import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AgendaItem, EventFileRecord, EventRecord, EventTask, SessionUser } from "../types";
import { Alert, Badge, Button, EmptyState, Input, Section, Textarea } from "./ui";
import { CalendarDotsIcon, CheckCircleIcon, FileTextIcon, PlusIcon, Trash2Icon } from "./icons";

function localDateTime(value?: string) {
  const date = value ? new Date(value) : new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function errorMessage(result: { error: string | null }, fallback: string) {
  return result.error || fallback;
}

export function TasksPanel({ event, user, canEdit, canDelete }: { event: EventRecord; user: SessionUser; canEdit: boolean; canDelete: boolean }) {
  const [tasks, setTasks] = useState<EventTask[]>([]);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [assignees, setAssignees] = useState<{ id: string; name: string; email: string }[]>([]);
  const [editing, setEditing] = useState<EventTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const [result, assigneeResult] = await Promise.all([
      api.listEventTasks(event.id, user.id),
      api.listEventTaskAssignees(event.id, user.id),
    ]);
    if (result.success && result.data) setTasks(result.data);
    else setError(errorMessage(result, "Could not load tasks."));
    if (assigneeResult.success && assigneeResult.data) setAssignees(assigneeResult.data);
  }
  useEffect(() => { void load(); }, [event.id, user.id]);

  function startEdit(task: EventTask) {
    setEditing(task); setTitle(task.title); setNotes(task.notes);
    setDueAt(task.dueAt ? localDateTime(task.dueAt) : ""); setAssigneeId(task.assigneeId ?? ""); setError("");
  }
  function resetForm() { setEditing(null); setTitle(""); setNotes(""); setDueAt(""); setAssigneeId(""); }
  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(""); setNotice("");
    const due = dueAt ? new Date(dueAt).toISOString() : null;
    const result = editing
      ? await api.updateEventTask(event.id, editing.id, user.id, title, notes, assigneeId || null, due)
      : await api.createEventTask(event.id, user.id, title, notes, assigneeId || null, due);
    if (!result.success) setError(errorMessage(result, "Could not save task."));
    else { resetForm(); setNotice("Task saved locally and queued for sync."); await load(); }
    setBusy(false);
  }
  async function toggle(task: EventTask) {
    const result = await api.setEventTaskStatus(event.id, task.id, user.id, task.status === "done" ? "open" : "done");
    if (!result.success) setError(errorMessage(result, "Could not update task.")); else await load();
  }
  async function remove(task: EventTask) {
    if (!window.confirm(`Delete “${task.title}”?`)) return;
    const result = await api.deleteEventTask(event.id, task.id, user.id);
    if (!result.success) setError(errorMessage(result, "Could not delete task.")); else await load();
  }

  return <div className="space-y-4">
    <Alert tone="info">Tasks sync with the website when this desktop is paired and online. Changes are queued while offline.</Alert>
    {error && <Alert tone="danger">{error}</Alert>}{notice && <Alert tone="success">{notice}</Alert>}
    {canEdit && <Section title={editing ? "Edit task" : "Add a task"} icon={<CheckCircleIcon className="h-4 w-4" />}>
      <form onSubmit={(e) => void save(e)} className="space-y-3">
        <Input id="task-title" label="Task title" value={title} onChange={(e) => setTitle(e.currentTarget.value)} required />
        <Textarea id="task-notes" label="Notes" value={notes} onChange={(e) => setNotes(e.currentTarget.value)} rows={2} />
        <label className="space-y-1.5 text-[12px] font-semibold text-ink-soft">Assignee<select id="task-assignee" value={assigneeId} onChange={(e) => setAssigneeId(e.currentTarget.value)} className="flex w-full rounded-xl border border-line bg-white px-3.5 py-[11px] text-[13px]"><option value="">Unassigned</option>{assignees.map((person) => <option key={person.id} value={person.id}>{person.name} · {person.email}</option>)}</select></label>
        <Input id="task-due" label="Due date (optional)" type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.currentTarget.value)} />
        <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : editing ? "Save task" : <><PlusIcon className="h-4 w-4" />Add task</>}</Button>{editing && <Button variant="secondary" onClick={resetForm}>Cancel</Button>}</div>
      </form>
    </Section>}
    <Section title={`Checklist · ${tasks.filter((t) => t.status === "done").length}/${tasks.length} complete`} bodyClassName="p-0">
      {tasks.length === 0 ? <EmptyState title="No tasks yet" description="Add checklist items to keep event work organized." icon={<CheckCircleIcon className="h-5 w-5" />} /> : <ul className="divide-y divide-line-soft">{tasks.map((task) => <li key={task.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
        <input aria-label={`Mark ${task.title} ${task.status === "done" ? "open" : "done"}`} type="checkbox" checked={task.status === "done"} disabled={!canEdit} onChange={() => void toggle(task)} className="h-4 w-4 accent-[#6558d3]" />
        <div className="min-w-0 flex-1"><p className={`text-[12.5px] font-semibold ${task.status === "done" ? "text-muted line-through" : "text-ink"}`}>{task.title}</p>{task.notes && <p className="mt-0.5 text-[11.5px] text-muted">{task.notes}</p>}{task.assigneeName && <p className="mt-1 text-[10.5px] text-muted">Assigned to {task.assigneeName}</p>}{task.dueAt && <p className="mt-1 text-[10.5px] text-faint">Due {new Date(task.dueAt).toLocaleString()}</p>}</div>
        <Badge tone={task.status === "done" ? "success" : "neutral"}>{task.status}</Badge>
        {canEdit && <Button size="sm" variant="secondary" onClick={() => startEdit(task)}>Edit</Button>}{canDelete && <Button size="sm" variant="danger" onClick={() => void remove(task)}><Trash2Icon className="h-3.5 w-3.5" />Delete</Button>}
      </li>)}</ul>}
    </Section>
  </div>;
}

export function SchedulePanel({ event, user, canEdit }: { event: EventRecord; user: SessionUser; canEdit: boolean }) {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [editing, setEditing] = useState<AgendaItem | null>(null);
  const [title, setTitle] = useState(""); const [description, setDescription] = useState("");
  const [startsAt, setStartsAt] = useState(localDateTime(event.startsAt)); const [duration, setDuration] = useState("30");
  const [location, setLocation] = useState(""); const [speaker, setSpeaker] = useState(""); const [status, setStatus] = useState<AgendaItem["status"]>("scheduled");
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  async function load() { const result = await api.listAgendaItems(event.id, user.id); if (result.success && result.data) setItems(result.data); else setError(errorMessage(result, "Could not load schedule.")); }
  useEffect(() => { void load(); }, [event.id, user.id]);
  function reset() { setEditing(null); setTitle(""); setDescription(""); setStartsAt(localDateTime(event.startsAt)); setDuration("30"); setLocation(""); setSpeaker(""); setStatus("scheduled"); }
  function edit(item: AgendaItem) { setEditing(item); setTitle(item.title); setDescription(item.description); setStartsAt(localDateTime(item.startsAt)); setDuration(String(item.durationMinutes)); setLocation(item.location); setSpeaker(item.speakerName); setStatus(item.status); setError(""); }
  async function save(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); setBusy(true); setError(""); setNotice(""); const result = await api.saveAgendaItem({ eventId:event.id, actorId:user.id, itemId:editing?.id ?? null, title, description, startsAt:new Date(startsAt).toISOString(), durationMinutes:Number(duration), location, speakerName:speaker, status }); if (!result.success) setError(errorMessage(result,"Could not save session.")); else { reset(); setNotice("Schedule saved locally and queued for sync."); await load(); } setBusy(false); }
  async function remove(item: AgendaItem) { if (!window.confirm(`Delete “${item.title}”?`)) return; const result=await api.deleteAgendaItem(event.id,user.id,item.id); if(!result.success)setError(errorMessage(result,"Could not delete session."));else await load(); }
  return <div className="space-y-4"><Alert tone="info">Agenda entries sync with the website when this desktop is paired and online. Changes are queued while offline.</Alert>{error&&<Alert tone="danger">{error}</Alert>}{notice&&<Alert tone="success">{notice}</Alert>}
    {canEdit && <Section title={editing ? "Edit session" : "Add a session"} icon={<CalendarDotsIcon className="h-4 w-4" />}><form onSubmit={(e)=>void save(e)} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2"><Input id="agenda-title" label="Session title" value={title} onChange={(e)=>setTitle(e.currentTarget.value)} required /></div>
      <div className="sm:col-span-2"><Textarea id="agenda-description" label="Description" rows={2} value={description} onChange={(e)=>setDescription(e.currentTarget.value)} /></div>
      <Input id="agenda-start" label="Starts" type="datetime-local" value={startsAt} onChange={(e)=>setStartsAt(e.currentTarget.value)} required />
      <Input id="agenda-duration" label="Duration (minutes)" type="number" value={duration} onChange={(e)=>setDuration(e.currentTarget.value)} required />
      <Input id="agenda-location" label="Location" value={location} onChange={(e)=>setLocation(e.currentTarget.value)} />
      <Input id="agenda-speaker" label="Speaker / host" value={speaker} onChange={(e)=>setSpeaker(e.currentTarget.value)} />
      <label className="space-y-1.5 text-[12px] font-semibold text-ink-soft">Status<select value={status} onChange={(e)=>setStatus(e.currentTarget.value as AgendaItem["status"])} className="flex w-full rounded-xl border border-line bg-white px-3.5 py-[11px] text-[13px]">{["scheduled","live","completed","cancelled"].map((s)=><option key={s}>{s}</option>)}</select></label>
      <div className="flex items-end gap-2"><Button type="submit" disabled={busy}>{busy?"Saving…":editing?"Save session":"Add session"}</Button>{editing&&<Button variant="secondary" onClick={reset}>Cancel</Button>}</div>
    </form></Section>}
    <Section title={`Run of show · ${items.length} sessions`} bodyClassName="p-0">{items.length===0?<EmptyState title="No schedule yet" description="Add agenda sessions and organize the event run of show." icon={<CalendarDotsIcon className="h-5 w-5" />} />:<ol className="divide-y divide-line-soft">{items.map((item)=><li key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-5"><time className="w-28 shrink-0 text-[11px] font-semibold text-accent">{new Date(item.startsAt).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}<span className="block text-[10px] font-normal text-faint">{item.durationMinutes} min</span></time><div className="min-w-0 flex-1"><p className="text-[12.5px] font-semibold text-ink">{item.title}</p>{item.description&&<p className="mt-0.5 text-[11.5px] text-muted">{item.description}</p>}<p className="mt-1 text-[10.5px] text-faint">{[item.location,item.speakerName].filter(Boolean).join(" · ")||"No location or speaker"}</p></div><Badge tone={item.status==="completed"?"success":item.status==="live"?"info":"neutral"}>{item.status}</Badge>{canEdit&&<Button size="sm" variant="secondary" onClick={()=>edit(item)}>Edit</Button>}{canEdit&&<Button size="sm" variant="danger" onClick={()=>void remove(item)}><Trash2Icon className="h-3.5 w-3.5" />Delete</Button>}</li>)}</ol>}</Section>
  </div>;
}

function fileDataUrl(base64: string, mime: string) { return `data:${mime || "application/octet-stream"};base64,${base64}`; }
export function FilesPanel({ event, user, canManage }: { event: EventRecord; user: SessionUser; canManage: boolean }) {
  const [files,setFiles]=useState<EventFileRecord[]>([]);const [error,setError]=useState("");const [notice,setNotice]=useState("");const [busy,setBusy]=useState(false);const [dragging,setDragging]=useState(false);const [previewFile,setPreviewFile]=useState<EventFileRecord|null>(null);const [previewUrl,setPreviewUrl]=useState("");const [previewText,setPreviewText]=useState("");
  async function load(){const result=await api.listEventFiles(event.id,user.id);if(result.success&&result.data)setFiles(result.data);else setError(errorMessage(result,"Could not load files."));}
  useEffect(()=>{void load()},[event.id,user.id]);
  async function uploadFiles(selected:File[],clear?:()=>void){if(!selected.length)return;setError("");setNotice("");const oversized=selected.find((file)=>file.size>20*1024*1024);if(oversized){setError(`“${oversized.name}” is larger than 20 MB.`);clear?.();return}setBusy(true);let uploaded=0;try{for(const file of selected){const bytes=await file.arrayBuffer();let binary="";const arr=new Uint8Array(bytes);for(let i=0;i<arr.length;i+=0x8000)binary+=String.fromCharCode(...arr.subarray(i,Math.min(i+0x8000,arr.length)));const result=await api.uploadEventFile(event.id,user.id,file.name,file.type||"application/octet-stream",btoa(binary));if(!result.success)throw new Error(errorMessage(result,`Could not upload ${file.name}.`));uploaded++}setNotice(`${uploaded} file${uploaded===1?"":"s"} saved locally and queued for sync.`);await load()}catch(reason){setError(String(reason));if(uploaded)await load()}finally{setBusy(false);clear?.()}}
  async function upload(e:React.ChangeEvent<HTMLInputElement>){const input=e.currentTarget;await uploadFiles(Array.from(input.files??[]),()=>{input.value=""})}
  async function download(file:EventFileRecord){const result=await api.downloadEventFile(event.id,user.id,file.id);if(!result.success){setError(errorMessage(result,"Download failed."));return}const link=document.createElement("a");link.href=fileDataUrl(result.data??"",file.mimeType);link.download=file.name;link.click()}
  async function preview(file:EventFileRecord){const result=await api.downloadEventFile(event.id,user.id,file.id);if(!result.success){setError(errorMessage(result,"Preview failed."));return}const encoded=result.data??"";const url=fileDataUrl(encoded,file.mimeType);if(file.mimeType.startsWith("text/")||file.mimeType==="application/json"||file.mimeType==="application/xml"){const binary=atob(encoded);const bytes=Uint8Array.from(binary,(character)=>character.charCodeAt(0));setPreviewText(new TextDecoder().decode(bytes).slice(0,100_000));setPreviewUrl("");setPreviewFile(file);return}if(file.mimeType.startsWith("image/")||file.mimeType==="application/pdf"||file.mimeType.startsWith("audio/")||file.mimeType.startsWith("video/")){setPreviewText("");setPreviewFile(file);setPreviewUrl(url);return}setError("No preview is available for this format. Download the file to open it.")}
  async function rename(file:EventFileRecord){const name=window.prompt("New file name",file.name);if(name===null||name.trim()===file.name)return;setError("");try{const result=await api.renameEventFile(event.id,user.id,file.id,name);if(!result.success)setError(errorMessage(result,"Could not rename file."));else{setNotice("File renamed.");await load()}}catch(reason){setError(reason instanceof Error?reason.message:"Could not rename file.")}}
  async function remove(file:EventFileRecord){if(!window.confirm(`Delete “${file.name}”?`))return;const result=await api.deleteEventFile(event.id,user.id,file.id);if(!result.success)setError(errorMessage(result,"Could not delete file."));else await load()}
  const total=files.reduce((sum,file)=>sum+file.sizeBytes,0);
  return <div className="space-y-4"><Alert tone="info">Event files sync with the website when this desktop is paired and online. Files are queued while offline and limited to 20 MB per file.</Alert>{error&&<Alert tone="danger">{error}</Alert>}{notice&&<Alert tone="success">{notice}</Alert>}
    {canManage && <Section title="Upload files" icon={<FileTextIcon className="h-4 w-4" />}><label onDragOver={(e)=>{e.preventDefault();setDragging(true)}} onDragEnter={(e)=>{e.preventDefault();setDragging(true)}} onDragLeave={(e)=>{if(e.currentTarget===e.target)setDragging(false)}} onDrop={(e)=>{e.preventDefault();setDragging(false);if(busy||!e.dataTransfer.files.length)return;const transfer=new DataTransfer();Array.from(e.dataTransfer.files).forEach((file)=>transfer.items.add(file));void uploadFiles(Array.from(transfer.files))}} className={`flex cursor-pointer flex-col items-center rounded-xl border border-dashed p-7 text-center ${dragging?"border-accent bg-accent-soft/40":"border-line-strong bg-sunken/50 hover:border-accent"}`}><span className="text-[13px] font-semibold text-ink">{dragging?"Drop files to upload":busy?"Saving files…":"Choose files or drag them here"}</span><span className="mt-1 text-[11.5px] text-muted">Select multiple files · Maximum 20 MB each · Queued for sync when paired</span><input type="file" multiple disabled={busy} onChange={(e)=>void upload(e)} className="sr-only" /></label></Section>}
    <Section title={`Shared files · ${files.length} · ${(total/1024/1024).toFixed(1)} MB`} bodyClassName="p-0">{files.length===0?<EmptyState title="No files yet" description="Upload event documents to keep them available on this computer." icon={<FileTextIcon className="h-5 w-5" />} />:<ul className="divide-y divide-line-soft">{files.map((file)=><li key={file.id} className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent"><FileTextIcon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><button type="button" onClick={()=>void preview(file)} className="block max-w-full truncate text-left text-[12.5px] font-semibold text-ink underline-offset-2 hover:text-accent hover:underline">{file.name}</button><span className="mt-0.5 block text-[10.5px] text-muted">{(file.sizeBytes/1024).toFixed(file.sizeBytes>1024*1024?0:1)} KB · {file.uploaderName} · {new Date(file.createdAt).toLocaleDateString()}</span></span><Button size="sm" variant="secondary" onClick={()=>void download(file)}>Download</Button>{canManage&&<Button size="sm" variant="secondary" onClick={()=>void rename(file)}>Rename</Button>}{canManage&&<Button size="sm" variant="danger" onClick={()=>void remove(file)}><Trash2Icon className="h-3.5 w-3.5" />Delete</Button>}</li>)}</ul>}</Section>
    {previewFile && <div role="presentation" onClick={(e)=>{if(e.target===e.currentTarget){setPreviewFile(null);setPreviewUrl("");setPreviewText("")}}} onKeyDown={(e)=>{if(e.key==="Escape"){setPreviewFile(null);setPreviewUrl("")}}} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"><section role="dialog" aria-modal="true" aria-label={`Preview ${previewFile.name}`} className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white"><header className="flex items-center gap-3 border-b p-4"><strong className="min-w-0 flex-1 truncate text-sm">{previewFile.name}</strong><button type="button" aria-label="Close preview" onClick={()=>{setPreviewFile(null);setPreviewUrl("");setPreviewText("")}} className="rounded-lg px-2 text-xl text-gray-500 hover:bg-gray-100">×</button></header><div className="flex min-h-[240px] flex-1 items-center justify-center overflow-auto bg-gray-50 p-4">{previewFile.mimeType.startsWith("image/")?<img src={previewUrl} alt={previewFile.name} className="max-h-[70vh] max-w-full object-contain"/>:previewFile.mimeType==="application/pdf"?<iframe title={previewFile.name} src={previewUrl} className="h-[70vh] w-full bg-white"/>:previewFile.mimeType.startsWith("video/")?<video src={previewUrl} controls className="max-h-[70vh] max-w-full"/>:previewFile.mimeType.startsWith("audio/")?<audio src={previewUrl} controls/>:<pre className="max-h-[70vh] w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-4 text-xs text-gray-700">{previewText}</pre>}</div></section></div>}
  </div>;
}
