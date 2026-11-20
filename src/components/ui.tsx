"use client";

import type { ReactNode } from "react";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

/* ------------------------------------------------------------------ Button */

export type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  value?: string;
};

export function Button({
  children,
  onClick,
  variant = "primary",
  size = "md",
  disabled,
  className,
  type = "button",
  value,
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-xl font-semibold transition-all duration-200 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 select-none";
  const sizes: Record<string, string> = {
    sm: "px-3 py-1.5 text-[11.5px]",
    md: "px-4 py-2.5 text-[12.5px]",
  };
  const variants: Record<string, string> = {
    primary:
      "bg-[#7468e8] text-white shadow-sm shadow-indigo-900/10 hover:bg-[#8277f0] hover:shadow-md hover:shadow-indigo-900/15",
    secondary:
      "border border-[#e7e9f2] bg-white text-[#3c4159] hover:border-[#d5d2fa] hover:bg-[#fbfaff] hover:text-[#272b43] hover:-translate-y-px hover:shadow-md hover:shadow-indigo-950/5",
    ghost:
      "text-[#545b73] hover:bg-[#f3f4f9] hover:text-[#252941]",
    danger:
      "border-2 border-red-300 bg-danger-soft text-danger hover:bg-red-100 hover:border-red-400",
  };
  return (
    <button
      type={type}
      value={value}
      onClick={onClick}
      disabled={disabled}
      className={cn(base, sizes[size], variants[variant], focusRing, className)}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------- Card */

export type CardProps = { children: ReactNode; className?: string };
export function Card({ children, className }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-[18px] border border-[#e7e9f2] bg-white shadow-[0_2px_8px_rgba(31,36,67,0.025)] transition-shadow duration-200 hover:shadow-[0_14px_32px_-22px_rgba(31,36,67,0.22)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------- PageHeader */

export type PageHeaderProps = {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn(
        "flex flex-col gap-4 border-b border-[#e7e9f2] pb-6 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="inline-flex items-center rounded-md bg-[#f0efff] px-2 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-[#5b50c5]">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-2 font-display text-[29px] font-semibold leading-tight tracking-[-0.035em] text-[#20243b] sm:text-[34px]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-[#737a91]">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      )}
    </header>
  );
}

/* ----------------------------------------------------------------- Section */

export type SectionProps = {
  title?: ReactNode;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
};

export function Section({
  title,
  description,
  icon,
  action,
  children,
  className,
  bodyClassName,
}: SectionProps) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[18px] border border-[#e7e9f2] bg-white shadow-[0_2px_8px_rgba(31,36,67,0.025)]",
        className,
      )}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-[#eef0f6] bg-[#fcfcfe] px-5 py-4">
          <div className="flex min-w-0 items-center gap-2.5">
            {icon && (
              <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#f0efff] text-[#6558d3]">
                {icon}
              </span>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-[13px] font-semibold text-ink">
                {title}
              </h2>
              {description && (
                <p className="truncate text-[11.5px] text-muted">
                  {description}
                </p>
              )}
            </div>
          </div>
          {action}
        </div>
      )}
      <div className={cn("bg-white p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------- Badge */

export type BadgeTone =
  | "neutral"
  | "accent"
  | "success"
  | "warning"
  | "info"
  | "danger";

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  const tones: Record<BadgeTone, string> = {
    neutral: "bg-sunken text-ink-soft ring-line",
    accent: "bg-accent-soft text-accent-ink ring-accent-line",
    success: "bg-success-soft text-success ring-success-line",
    warning: "bg-warning-soft text-warning ring-warning-line",
    info: "bg-info-soft text-info ring-info-line",
    danger: "bg-danger-soft text-danger ring-danger-line",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10.5px] font-semibold ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- Alert */

export function Alert({
  children,
  tone = "info",
  className,
}: {
  children: ReactNode;
  tone?: "info" | "success" | "danger" | "warning";
  className?: string;
}) {
  const tones: Record<string, string> = {
    info: "border-info-line bg-info-soft text-info",
    success: "border-success-line bg-success-soft text-success",
    danger: "border-danger-line bg-danger-soft text-danger",
    warning: "border-warning-line bg-warning-soft text-warning",
  };
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "rounded-xl border px-3.5 py-2.5 text-[12.5px] font-medium",
        tones[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- StatCard */

export type StatCardProps = {
  label: string;
  value: string;
  caption?: string;
  icon?: ReactNode;
};

export function StatCard({ label, value, caption, icon }: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-line bg-panel p-5 shadow-card transition-shadow hover:shadow-lg">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-widest text-muted">
          {label}
        </h3>
        {icon && (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-white">
            {icon}
          </span>
        )}
      </div>
      <p className="mt-3 text-[28px] font-bold leading-none tracking-tight text-ink">
        {value}
      </p>
      {caption && (
        <p className="mt-2 text-[11.5px] leading-snug text-muted">{caption}</p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------- EmptyState */

export type EmptyStateProps = {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
};

export function EmptyState({
  title,
  description,
  action,
  icon,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="flex h-[60px] w-[60px] items-center justify-center rounded-full bg-sunken text-faint shadow-inner">
        {icon ?? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect width="18" height="18" x="3" y="4" rx="2" />
            <path d="M8 2v4M16 2v4M3 10h18" />
          </svg>
        )}
      </div>
      <h3 className="mt-4 text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-1.5 max-w-sm text-[12px] leading-relaxed text-muted">
        {description}
      </p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- Input */

export type InputProps = {
  id?: string;
  label?: string;
  type?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus?: (e: React.FocusEvent<HTMLInputElement>) => void;
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  error?: string;
  hint?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  min?: string | number;
  max?: string | number;
  maxLength?: number;
  className?: string;
};

export function Input({
  id,
  label,
  type = "text",
  value,
  onChange,
  onFocus,
  placeholder,
  readOnly,
  disabled,
  error,
  hint,
  autoComplete,
  required,
  minLength,
  min,
  max,
  maxLength,
  className,
}: InputProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={id}
          className="block text-[12px] font-semibold text-ink-soft"
        >
          {label}
        </label>
      )}
      <input
        id={id}
        type={type}
        value={value ?? ""}
        onChange={onChange}
        onFocus={onFocus}
        placeholder={placeholder}
        readOnly={readOnly}
        disabled={disabled}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        min={min}
        max={max}
        maxLength={maxLength}
        className={cn(
          "flex w-full rounded-xl border bg-white px-3.5 py-[11px] text-[13px] text-[#272b43] shadow-sm transition-all duration-200 placeholder:text-[#969bb0]",
          error
            ? "border-danger-line focus-visible:ring-danger/40"
            : "border-line hover:border-line-strong focus-visible:border-accent/60",
          focusRing,
          disabled && "cursor-not-allowed bg-sunken/60 text-muted",
          className,
        )}
      />
      {error ? (
        <p className="text-[11px] font-medium text-danger">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- Textarea */

export type TextareaProps = {
  id?: string;
  label?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  error?: string;
  className?: string;
};

export function Textarea({
  id,
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  required,
  error,
  className,
}: TextareaProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={id}
          className="block text-[12px] font-semibold text-ink-soft"
        >
          {label}
        </label>
      )}
      <textarea
        id={id}
        value={value ?? ""}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        required={required}
        className={cn(
          "flex w-full resize-y rounded-xl border border-[#e2e5ef] bg-white px-3.5 py-3 text-[13px] leading-relaxed text-[#272b43] shadow-sm transition-all duration-150 placeholder:text-[#969bb0] hover:border-[#cfd3e1] focus-visible:border-accent/60",
          focusRing,
          error && "border-danger-line",
          className,
        )}
      />
      {error && <p className="text-[11px] font-medium text-danger">{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ Select */

export type SelectProps = {
  id?: string;
  label?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void;
  children: ReactNode;
  hint?: string;
  className?: string;
};

export function Select({
  id,
  label,
  value,
  onChange,
  children,
  hint,
  className,
}: SelectProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label
          htmlFor={id}
          className="block text-[12px] font-semibold text-ink-soft"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <select
          id={id}
          value={value}
          onChange={onChange}
          className={cn(
            "flex w-full appearance-none rounded-xl border border-[#e2e5ef] bg-white px-3.5 py-[11px] pr-9 text-[13px] text-[#272b43] shadow-sm transition-all duration-150 hover:border-[#cfd3e1] focus-visible:border-accent/60",
            focusRing,
            className,
          )}
        >
          {children}
        </select>
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </div>
      {hint && <p className="text-[11px] text-muted">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ Toggle */

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  description?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-line-soft bg-raised px-4 py-3">
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold text-ink">{label}</p>
        {description && (
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
            {description}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={cn(
          "relative mt-0.5 h-[24px] w-[42px] shrink-0 rounded-full transition-all duration-200",
          checked ? "bg-[#6558d3] shadow-sm shadow-indigo-900/15" : "bg-line-strong",
          focusRing,
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-sm transition-transform duration-200",
            checked ? "translate-x-[21px]" : "translate-x-[3px]",
          )}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ Avatar */

export function Avatar({
  name,
  src,
  size = "md",
  className,
}: {
  name: string;
  src?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizes: Record<string, string> = {
    sm: "h-7 w-7 text-[10px]",
    md: "h-9 w-9 text-[11.5px]",
    lg: "h-12 w-12 text-[15px]",
  };
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn(
          "shrink-0 rounded-full object-cover ring-2 ring-line ring-offset-1 ring-offset-canvas",
          sizes[size],
          className,
        )}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-[#6558d3] font-semibold text-white ring-2 ring-inset ring-white/25",
        sizes[size],
        className,
      )}
    >
      {initials || "?"}
    </span>
  );
}

/* ---------------------------------------------------------------- Skeleton */

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse rounded-2xl bg-sunken", className)}
    />
  );
}

/* ------------------------------------------------------------- IconButton */

export function IconButton({
  children,
  onClick,
  label,
  active,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  label: string;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
        active
          ? "bg-accent-soft text-accent"
          : "text-muted hover:bg-sunken hover:text-ink",
        focusRing,
        className,
      )}
    >
      {children}
    </button>
  );
}

/* --------------------------------------------------------------- MetaChip */

export function MetaChip({
  icon,
  children,
  className,
}: {
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-line-soft bg-sunken px-2 py-1 text-[11px] font-medium text-ink-soft",
        className,
      )}
    >
      {icon && <span className="text-faint">{icon}</span>}
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- StatStrip */

export type StatStripItem = {
  label: string;
  value: string;
  caption?: string;
  icon?: ReactNode;
};

export function StatStrip({ items }: { items: StatStripItem[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-line-soft shadow-panel">
      <div className="grid grid-cols-1 gap-px sm:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="bg-white px-5 py-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-mono text-[9px] font-semibold uppercase tracking-eyebrow text-muted">
                {item.label}
              </h3>
              {item.icon && <span className="text-line-strong">{item.icon}</span>}
            </div>
            <p className="mt-2 text-[25px] font-semibold leading-none tracking-tight text-ink">
              {item.value}
            </p>
            {item.caption && (
              <p className="mt-1.5 truncate text-[11px] text-muted">
                {item.caption}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- Segmented */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex w-full gap-0.5 overflow-x-auto rounded-xl border border-line bg-[#f2f3f8] p-1 sm:w-auto",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors sm:flex-none",
              active
                ? "bg-white text-ink shadow-panel"
                : "text-muted hover:bg-white/70 hover:text-ink",
            )}
          >
            {option.label}
            {typeof option.count === "number" && (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px font-mono text-[9.5px]",
                  active ? "bg-[#ebe9ff] text-[#4940a1]" : "bg-sunken text-muted",
                )}
              >
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
