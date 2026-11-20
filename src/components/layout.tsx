"use client";

import { useState, type ReactNode } from "react";
import { useAuth } from "../App";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="app-shell flex h-screen overflow-hidden bg-[#f5f6fb] text-[#20243b]">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
        onSignOut={signOut}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          user={user}
          onSignOut={signOut}
          onMenuToggle={() => setSidebarOpen((previous) => !previous)}
        />
        <main className="app-main flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1600px] px-4 pb-12 pt-6 sm:px-7 lg:px-10 lg:pt-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
