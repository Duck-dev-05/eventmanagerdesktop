import type { ReactNode } from "react";
import { CalendarIcon, CheckCircleIcon, ClockIcon, UsersIcon } from "./icons";

export function AuthLayout({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[minmax(340px,0.92fr)_1.08fr]">
      <aside className="relative hidden min-h-screen flex-col justify-between overflow-hidden bg-nav px-10 py-9 text-white lg:flex xl:px-14 xl:py-12">
        <div aria-hidden="true" className="pointer-events-none absolute -right-36 -top-24 h-[440px] w-[440px] rounded-full bg-accent/20 blur-[100px]" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -left-28 h-[440px] w-[440px] rounded-full bg-emerald-400/[0.08] blur-[100px]" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-grid opacity-[0.12]" />

        <div className="relative flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white shadow-lg shadow-black/20">
            <CalendarIcon className="h-[19px] w-[19px]" />
          </span>
          <span>
            <span className="block text-[15px] font-semibold tracking-tight">EventPulse</span>
            <span className="mt-0.5 block font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-white/45">Event workspace</span>
          </span>
        </div>

        <div className="relative mx-auto w-full max-w-[490px] py-12">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/65">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Your events, in sync
          </div>
          <h1 className="max-w-md text-[38px] font-semibold leading-[1.1] tracking-[-0.04em] xl:text-[46px]">
            Every detail in its right place.
          </h1>
          <p className="mt-4 max-w-sm text-[14px] leading-7 text-white/60">
            Bring your schedules, venues and people together in one thoughtful workspace.
          </p>

          <div className="mt-10 max-w-[420px] rounded-2xl border border-white/10 bg-white/[0.07] p-4 shadow-2xl shadow-black/20 backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-[#f1b394]"><CalendarIcon className="h-4 w-4" /></span>
                <span><span className="block text-[11px] font-semibold">Your workspace</span><span className="mt-0.5 block text-[9px] text-white/45">A little more organized</span></span>
              </div>
              <span className="rounded-full bg-emerald-400/10 px-2 py-1 text-[9px] font-semibold text-emerald-200">● Live</span>
            </div>
            <div className="space-y-2.5 pt-3">
              <div className="flex items-center gap-3 rounded-xl bg-white/[0.06] px-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 flex-col items-center justify-center rounded-lg bg-accent/15 text-[#f1b394]"><span className="text-[7px] font-semibold uppercase">JUN</span><span className="text-[13px] font-semibold leading-none">18</span></span>
                <span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-semibold">Product & design summit</span><span className="mt-1 flex items-center gap-1 text-[9px] text-white/45"><ClockIcon className="h-3 w-3" /> 10:30 AM · Main hall</span></span>
                <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-300/80" />
              </div>
              <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.08] text-white/65"><UsersIcon className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold">The right people, together</span><span className="mt-1 block text-[9px] text-white/45">Invite your team and keep plans aligned</span></span>
                <span className="flex -space-x-1.5"><i className="h-5 w-5 rounded-full border-2 border-[#25342b] bg-[#dba982]" /><i className="h-5 w-5 rounded-full border-2 border-[#25342b] bg-[#8caa91]" /><i className="h-5 w-5 rounded-full border-2 border-[#25342b] bg-[#aaa0c8]" /></span>
              </div>
            </div>
          </div>
        </div>

        <p className="relative font-mono text-[9px] uppercase tracking-eyebrow text-white/35">Event manager · desktop</p>
      </aside>

      <main className="flex min-h-screen items-center justify-center px-5 py-8 sm:px-8 lg:px-12 lg:py-12">
        <div className="w-full max-w-[440px]">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white shadow-sm"><CalendarIcon className="h-5 w-5" /></span>
            <span className="text-[14px] font-semibold tracking-tight text-ink">EventPulse</span>
          </div>

          <div className="rounded-2xl border border-line bg-white p-6 shadow-card sm:p-8">
            <div className="mb-7">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-accent">Welcome to EventPulse</p>
              <h2 className="mt-2 text-[25px] font-semibold tracking-tight text-ink">{title}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{description}</p>
            </div>
            {children}
          </div>
          <div className="mt-6 text-center text-[12.5px] text-muted">{footer}</div>
          <p className="mt-8 text-center font-mono text-[9px] uppercase tracking-eyebrow text-faint">Private by design · Your workspace awaits</p>
        </div>
      </main>
    </div>
  );
}
