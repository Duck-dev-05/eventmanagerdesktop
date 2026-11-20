"use client";

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { PageHeader, Section } from "../components/ui";
import { ChevronDownIcon, ChevronRightIcon, HelpCircleIcon, MailIcon, SettingsIcon, UserIcon } from "../components/icons";

const faqs = [
  { question: "How do I create an event?", answer: "Choose Create event in the sidebar or top bar. Add a title, date, venue and other details, then save. When live sync is connected, event changes are shared with your Event Manager website account." },
  { question: "How does live sync work?", answer: "Sign in with the same account you use on the website. The desktop app pairs automatically and syncs event details in the background. The Live sync indicator in the top bar shows connection status." },
  { question: "Where can I manage team members?", answer: "Open one of your events and select Members. Accepted website members and their roles appear there after sync." },
  { question: "Where do I change my profile or preferences?", answer: "Open Profile or Settings from the account menu or sidebar. Your account profile is stored locally on this device and synchronized according to the connected account." },
  { question: "Can I duplicate an event or add it to my calendar?", answer: "Event owners can use Duplicate on an event to copy its details, schedule and checklist to a new date. Use Add to calendar to download an .ics file that works with common calendar apps." },
  { question: "Can I rename or remove event files?", answer: "Owners and event admins can upload, download, rename and delete event files. File storage is local to this computer and the Files tab shows the total size used by the event." },
  { question: "Which event details sync with the website?", answer: "Event details, tasks, agenda entries and files sync when the desktop is paired and online. Offline work is queued and retried automatically; files must be 20 MB or smaller." }
];

export function HelpPage() {
  const navigate = useNavigate();
  const [openQuestion, setOpenQuestion] = useState<string | null>(faqs[0].question);
  return <div className="space-y-6">
    <PageHeader eyebrow="Account" title="Help & support" description="Answers and shortcuts for using EventPulse Desktop." />
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {[
        { href: "/profile", label: "Your profile", description: "Update your display name and account details.", Icon: UserIcon, local: true },
        { href: "/settings", label: "Settings", description: "Manage reminders and event preferences.", Icon: SettingsIcon, local: true },
        { href: "mailto:support@eventpulse.app", label: "Email support", description: "Contact the EventPulse support team.", Icon: MailIcon, local: false },
      ].map(({ href, label, description, Icon, local }) => <button key={href} type="button" onClick={() => local ? navigate(href) : void openUrl(href)} className="group rounded-2xl border border-line bg-panel p-5 text-left shadow-panel transition-shadow hover:shadow-card"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon className="h-[18px] w-[18px]" /></span><span className="mt-4 flex items-center gap-1.5 text-[14px] font-semibold text-ink group-hover:text-accent">{label}<ChevronRightIcon className="h-4 w-4 text-faint" /></span><span className="mt-1 block text-[12px] leading-relaxed text-muted">{description}</span></button>)}
    </div>
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <Section title="Frequently asked questions" description="Quick answers to common questions." icon={<HelpCircleIcon className="h-4 w-4" />} bodyClassName="p-0">
        <div className="divide-y divide-line-soft">{faqs.map((faq) => <div key={faq.question} className="px-5 py-4"><button type="button" aria-expanded={openQuestion === faq.question} onClick={() => setOpenQuestion(openQuestion === faq.question ? null : faq.question)} className="flex w-full items-center justify-between gap-4 text-left text-[13px] font-medium text-ink">{faq.question}<ChevronDownIcon className={`h-4 w-4 shrink-0 text-faint transition-transform ${openQuestion === faq.question ? "rotate-180" : ""}`} /></button>{openQuestion === faq.question && <p className="mt-2 pr-8 text-[12px] leading-relaxed text-muted">{faq.answer}</p>}</div>)}</div>
      </Section>
      <Section title="Still stuck?" description="We’re here to help." icon={<MailIcon className="h-4 w-4" />}>
        <p className="text-[12.5px] leading-relaxed text-muted">Send us a note with the event name and what you expected to happen. We usually reply within one working day.</p>
        <button type="button" onClick={() => void openUrl("mailto:support@eventpulse.app")} className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-accent px-3.5 py-2 text-[12px] font-semibold text-white hover:bg-accent-hover"><MailIcon className="h-4 w-4" /> Email support</button>
        <div className="mt-5 rounded-xl bg-sunken p-4"><p className="text-[12px] font-semibold text-ink">A quick tip</p><p className="mt-1 text-[11.5px] leading-relaxed text-muted">Use the Live sync status in the top bar to check whether your events are paired with the website.</p></div>
      </Section>
    </div>
  </div>;
}
