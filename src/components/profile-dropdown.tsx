import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { LogOutIcon, SettingsIcon, UserIcon } from "./icons";
import { Avatar, cn } from "./ui";

type ProfileUser = {
  name: string;
  email: string;
  avatarUrl?: string | null;
} | null;

export function ProfileDropdown({
  user,
  onSignOut,
  placement = "bottom",
  appearance = "light",
  compact = false,
  detailsClassName,
}: {
  user: ProfileUser;
  onSignOut: () => Promise<void>;
  placement?: "top" | "bottom";
  appearance?: "light" | "sidebar";
  compact?: boolean;
  detailsClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const sidebar = appearance === "sidebar";

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open profile menu"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex min-w-0 items-center gap-2.5 rounded-xl text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
          sidebar
            ? "w-full border border-white/[0.1] bg-white/[0.06] px-2.5 py-2.5 text-white hover:border-white/20 hover:bg-white/[0.1]"
            : "px-1.5 py-1.5 text-[#343950] hover:bg-[#f3f4f9]",

          compact && "justify-center border-transparent bg-transparent px-0",
        )}
      >
        <Avatar
          name={user?.name ?? "Account"}
          src={user?.avatarUrl}
          size="sm"
          className={sidebar ? "ring-offset-[#171a2b]" : undefined}
        />
        {!compact && (
          <span className={cn("min-w-0 flex-1 leading-tight", detailsClassName)}>
            <span className={cn("block truncate text-[12px] font-semibold", sidebar ? "text-white" : "text-ink")}>
              {user?.name ?? "Account"}
            </span>
            <span className={cn("block truncate text-[10.5px]", sidebar ? "text-white/45" : "text-muted")}>
              {user?.email ?? ""}
            </span>
          </span>
        )}
        <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180", sidebar ? "text-nav-muted" : "text-muted", compact && "hidden")}>
          <path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Profile options"
          className={cn(
            "absolute z-[70] min-w-[220px] overflow-hidden rounded-xl border p-1.5 shadow-xl",
            placement === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
            "border-line bg-panel text-ink",
            compact ? "left-full bottom-0 ml-2" : "right-0",
          )}
        >
          <div className="border-b border-line-soft px-3 py-2.5">
            <p className="truncate text-[12px] font-semibold">{user?.name ?? "Account"}</p>
            <p className={cn("truncate text-[10.5px]", sidebar ? "text-nav-muted" : "text-muted")}>{user?.email}</p>
          </div>
          <Link
            role="menuitem"
            to="/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[12px] font-medium text-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            <UserIcon className="h-4 w-4" /> My profile
          </Link>
          <Link
            role="menuitem"
            to="/settings"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-[12px] font-medium text-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            <SettingsIcon className="h-4 w-4" /> Settings
          </Link>
          <div className="my-1 h-px bg-line-soft" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              void onSignOut();
            }}
            className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[12px] font-medium text-danger transition-colors hover:bg-danger-soft"
          >
            <LogOutIcon className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
