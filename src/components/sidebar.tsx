"use client";

import { useEffect, useState, type ReactElement } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  CalendarDotsIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GridIcon,
  MailIcon,
  PlusIcon,
  PulseIcon,
  SearchIcon,
  UsersIcon,
  XIcon,
} from "./icons";
import { cn } from "./ui";
import { ProfileDropdown } from "./profile-dropdown";

type NavLinkItem = {
  href: string;
  label: string;
  Icon: (props: { className?: string }) => ReactElement;
};

const navItems: NavLinkItem[] = [
  { href: "/dashboard", label: "Overview", Icon: GridIcon },
  { href: "/my-events", label: "My events", Icon: CalendarIcon },
  { href: "/search", label: "Search", Icon: SearchIcon },
  { href: "/calendar", label: "Calendar", Icon: CalendarDotsIcon },
  { href: "/invitations", label: "Invitations", Icon: MailIcon },
  { href: "/users", label: "People", Icon: UsersIcon },
  { href: "/my-activity", label: "Activity", Icon: PulseIcon },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  open,
  onClose,
  user,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  user: { id: string; name: string; email: string; avatarUrl?: string | null; workspaceRole?: string } | null;
  onSignOut: () => Promise<void>;
}) {
  const { pathname } = useLocation();
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    setCompact(window.localStorage.getItem("em:sidebar-compact") === "true");
  }, []);

  function toggleCompact() {
    setCompact((previous) => {
      window.localStorage.setItem("em:sidebar-compact", String(!previous));
      return !previous;
    });
  }

  return (
    <>
      {open && <button type="button" aria-label="Close navigation" className="fixed inset-0 z-40 bg-[#101323]/45 backdrop-blur-[2px] lg:hidden" onClick={onClose} />}
      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-[272px] flex-col bg-[#171a2b] text-white transition-[width,transform] duration-200 lg:static lg:z-auto lg:h-screen lg:shrink-0",
        open ? "translate-x-0" : "-translate-x-full",
        "lg:translate-x-0",
        compact ? "lg:w-[78px]" : "lg:w-[248px]", 
      )}>
        <div className={cn("flex h-[76px] shrink-0 items-center border-b border-white/[0.08] px-5", compact && "lg:justify-center lg:px-0")}>
          <Link to="/dashboard" onClick={onClose} aria-label="EventPulse home" className={cn("flex min-w-0 items-center gap-3", compact && "lg:justify-center")}>
            <img src="/eventpulse-icon.png" alt="" className="h-10 w-10 shrink-0 rounded-[13px] object-cover" />
            {!compact && <span className="min-w-0"><span className="block truncate text-[15px] font-semibold tracking-tight">EventPulse</span><span className="mt-0.5 block truncate text-[9px] font-medium uppercase tracking-[0.2em] text-white/40">Plan · Gather · Celebrate</span></span>}
          </Link>
          <button type="button" onClick={() => { if (window.innerWidth >= 1024) toggleCompact(); else onClose(); }} aria-label={compact ? "Expand sidebar" : "Collapse sidebar"} title={compact ? "Expand sidebar" : "Collapse sidebar"} className={cn("ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white/50 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40", compact && "lg:ml-0")}>
            <span className="hidden lg:block">{compact ? <ChevronRightIcon className="h-4 w-4" /> : <ChevronLeftIcon className="h-4 w-4" />}</span>
            <span className="lg:hidden"><XIcon className="h-4 w-4" /></span>
          </button>
        </div>

        <div className={cn("px-4 pt-5", compact && "lg:px-3")}>
          <Link to="/events/new" onClick={onClose} title={compact ? "Create event" : undefined} aria-label={compact ? "Create event" : undefined} className={cn("flex h-11 items-center justify-center gap-2 rounded-xl bg-[#7468e8] px-3 text-[13px] font-semibold text-white shadow-lg shadow-black/15 transition-colors hover:bg-[#8277f0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50", compact && "lg:px-0")}>
            <PlusIcon className="h-4 w-4 shrink-0" />{!compact && <span>Create event</span>}
          </Link>
        </div>

        <nav aria-label="Main navigation" className="sidebar-scroll mt-6 min-h-0 flex-1 overflow-y-auto px-3">
          {!compact && <p className="mb-2 px-3 text-[9px] font-semibold uppercase tracking-[0.2em] text-white/35">Workspace</p>}
          <ul className="space-y-1">
            {navItems.filter(({ href }) => href !== "/users" || user?.workspaceRole === "owner" || user?.workspaceRole === "admin").map(({ href, label, Icon }) => {
              const active = isActive(pathname, href);
              return <li key={href}><Link to={href} onClick={onClose} title={compact ? label : undefined} aria-label={compact ? label : undefined} aria-current={active ? "page" : undefined} className={cn("group relative flex h-11 items-center gap-3 rounded-xl px-3 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40", compact && "lg:justify-center lg:px-0", active ? "bg-white/[0.12] font-semibold text-white" : "font-medium text-white/60 hover:bg-white/[0.06] hover:text-white")}>
                {active && <span aria-hidden="true" className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#9c93ff]" />}
                <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-[#b8b2ff]" : "text-white/50 group-hover:text-white/80")} />
                {!compact && <span className="truncate">{label}</span>}
              </Link></li>;
            })}
          </ul>


        </nav>

        <div className="shrink-0 border-t border-white/[0.08] p-3">
          {!compact && <div className="mb-3 rounded-xl border border-white/[0.08] bg-white/[0.04] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/45">Your workspace</p><p className="mt-1 text-[12px] font-medium text-white/85">All your plans, together.</p><Link to="/calendar" onClick={onClose} className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-[#b8b2ff] hover:text-white">Open calendar <ChevronRightIcon className="h-3 w-3" /></Link></div>}
          <ProfileDropdown user={user} onSignOut={onSignOut} appearance="sidebar" placement="top" compact={compact} detailsClassName="text-white" />
        </div>
      </aside>
    </>
  );
}
