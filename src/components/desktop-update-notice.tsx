import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "./ui";

const RELEASE_API_URL =
  "https://api.github.com/repos/Duck-dev-05/eventmanagerdesktop/releases/latest";
const DISMISSED_VERSION_KEY = "em:dismissed-desktop-update";

type GitHubRelease = {
  tag_name?: string;
  html_url?: string;
};

type AvailableUpdate = {
  version: string;
  releaseUrl: string;
};

function versionParts(version: string): number[] | null {
  const match = version.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = versionParts(candidate);
  const currentParts = versionParts(current);
  if (!candidateParts || !currentParts) return false;

  for (let index = 0; index < 3; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index];
    }
  }
  return false;
}

export function DesktopUpdateNotice() {
  const [update, setUpdate] = useState<AvailableUpdate | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);

    async function checkForUpdate() {
      try {
        if (!isTauri()) return;
        const currentVersion = await getVersion();
        const response = await fetch(RELEASE_API_URL, {
          headers: { Accept: "application/vnd.github+json" },
          signal: controller.signal,
        });
        if (!response.ok) return;

        const release = (await response.json()) as GitHubRelease;
        const version = release.tag_name?.trim();
        const releaseUrl = release.html_url?.trim();
        const normalizedVersion = version?.replace(/^v/i, "");
        if (
          !version ||
          !normalizedVersion ||
          !releaseUrl?.startsWith("https://github.com/Duck-dev-05/eventmanagerdesktop/releases/") ||
          !isNewerVersion(version, currentVersion) ||
          localStorage.getItem(DISMISSED_VERSION_KEY) === normalizedVersion
        ) {
          return;
        }
        setUpdate({ version: normalizedVersion, releaseUrl });
      } catch {
        // Update checks are best-effort; the app remains usable while offline.
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void checkForUpdate();
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);

  if (!update) return null;

  function dismiss() {
    localStorage.setItem(DISMISSED_VERSION_KEY, update!.version);
    setUpdate(null);
  }

  async function openRelease() {
    try {
      await openUrl(update!.releaseUrl);
      dismiss();
    } catch {
      // Keep the notice open if the system could not open the release page.
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#17182a]/45 p-4 backdrop-blur-[2px]">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="desktop-update-title"
        className="w-full max-w-md rounded-2xl border border-line bg-white p-6 shadow-2xl"
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#f0efff] text-[#5b50c5]" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 16V4m0 0L7 9m5-5 5 5" />
            <path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5" />
          </svg>
        </div>
        <h2 id="desktop-update-title" className="mt-4 text-lg font-semibold text-ink">
          EventPulse {update.version} is available
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          A newer version of EventPulse is ready. Open the release page to view the changes and download the installer for your device.
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={dismiss}>Not now</Button>
          <Button onClick={() => void openRelease()}>View update</Button>
        </div>
      </section>
    </div>
  );
}
