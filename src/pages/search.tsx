import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../App";
import { api } from "../lib/api";
import type { WorkspaceSearchResult } from "../types";
import { Alert, EmptyState, Input, PageHeader, Section, Skeleton } from "../components/ui";
import { SearchIcon } from "../components/icons";

export function SearchPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WorkspaceSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || !query.trim()) { setResults([]); setLoading(false); setError(""); return; }
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      api.searchWorkspace(user.id, query.trim()).then((result) => {
        if (!active) return;
        if (result.success) setResults(result.data ?? []);
        else setError(result.error || "Search failed.");
      }).catch((reason) => { if (active) setError(String(reason)); })
        .finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, user]);

  const grouped = results.reduce<Record<string, WorkspaceSearchResult[]>>((groups, result) => {
    (groups[result.kind] ??= []).push(result);
    return groups;
  }, {});

  return <div className="space-y-6">
    <PageHeader eyebrow="Workspace" title="Search" description="Find events, tasks, sessions, people and files in your desktop workspace." />
    <div className="max-w-2xl"><Input id="workspace-search" label="Search your workspace" value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder="Try an event name, task, teammate or file…" autoComplete="off" /></div>
    {error && <Alert tone="danger">{error}</Alert>}
    {loading ? <div className="space-y-3"><Skeleton className="h-20"/><Skeleton className="h-20"/><Skeleton className="h-20"/></div> : !query.trim() ? <Section><EmptyState title="Search your workspace" description="Start typing to find events and related desktop data." icon={<SearchIcon className="h-5 w-5" />} /></Section> : results.length === 0 ? <Section><EmptyState title={`No results for “${query}”`} description="Try a shorter phrase or another keyword." icon={<SearchIcon className="h-5 w-5" />} /></Section> : <div className="space-y-4">{Object.entries(grouped).map(([kind, items]) => <Section key={kind} title={`${kind}s · ${items.length}`} bodyClassName="p-0"><ul className="divide-y divide-line-soft">{items.map((item) => <li key={`${kind}-${item.id}`}><button type="button" onClick={() => navigate(`/events/${item.eventId}`)} className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-raised"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><SearchIcon className="h-4 w-4"/></span><span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-semibold text-ink">{item.title}</span><span className="mt-1 block truncate text-[11px] text-muted">{item.detail}</span></span><span className="text-[11px] font-semibold text-accent">Open event →</span></button></li>)}</ul></Section>)}</div>}
  </div>;
}
