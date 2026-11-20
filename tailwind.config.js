/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f5f6fb",
        panel: "#ffffff",
        sunken: "#f5f6fb",
        raised: "#fafbfe",
        "surface-elevated": "#ffffff",

        ink: "#171d30",
        "ink-soft": "#3c455d",
        muted: "#66718a",
        faint: "#969fb3",

        line: "#e4e7f0",
        "line-soft": "#eef0f6",
        "line-strong": "#cfd5e3",

        accent: "#6558d3",
        "accent-hover": "#786be2",
        "accent-strong": "#4f43b3",
        "accent-soft": "#f0efff",
        "accent-line": "#dddbfb",
        "accent-ink": "#4940a1",

        nav: "#151b2d",
        "nav-soft": "#222a40",
        "nav-brand-top": "#1a2237",
        "nav-line": "#2b3349",
        "nav-ink": "#f0f2fa",
        "nav-muted": "#a0a9bf",
        "nav-active-bg": "rgba(101,88,211,0.22)",
        "nav-active-ring": "rgba(101,88,211,0.32)",
        "nav-active-icon": "#c4bfff",

        success: "#2f7d52",
        "success-soft": "#eaf4ee",
        "success-line": "#cbe6d7",
        danger: "#b4392f",
        "danger-soft": "#fbeeec",
        "danger-line": "#f3d3ce",
        warning: "#a76a12",
        "warning-soft": "#fdf3e3",
        "warning-line": "#f0dfc0",
        info: "#3b5b96",
        "info-soft": "#eef2fa",
        "info-line": "#d6e0f2",
      },
      fontFamily: {
        display: ["Cal Sans", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        sans: ["Inter", "Segoe UI Variable Text", "Segoe UI", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "Consolas", "ui-monospace", "monospace"],
      },
      boxShadow: {
        panel: "0 1px 2px rgba(26, 31, 58, 0.035), 0 1px 1px rgba(26, 31, 58, 0.02)",
        card: "0 1px 2px rgba(26, 31, 58, 0.035), 0 12px 28px -22px rgba(26, 31, 58, 0.24)",
        lift: "0 2px 5px rgba(26, 31, 58, 0.05), 0 20px 40px -28px rgba(26, 31, 58, 0.32)",
        float: "0 26px 52px -34px rgba(26, 31, 58, 0.38), 0 2px 6px rgba(26, 31, 58, 0.04)",
        "nav-active": "0 1px 3px rgba(101, 88, 211, 0.25), inset 0 1px 0 rgba(255,255,255,0.08)",
        topbar: "0 1px 0 #e4e7f0, 0 2px 8px -4px rgba(26,31,58,0.06)",
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "0.9rem",
        "3xl": "1.15rem",
      },
      letterSpacing: {
        eyebrow: "0.16em",
      },
      transitionDuration: {
        250: "250ms",
      },
    },
  },
  plugins: [],
};
