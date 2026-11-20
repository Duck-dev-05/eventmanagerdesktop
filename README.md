# EventPulse Desktop

EventPulse Desktop is a Tauri 2 application with a React, TypeScript, and Vite frontend and a local SQLite database.

## Requirements

- Node.js and npm
- Rust toolchain and Cargo
- Tauri platform prerequisites for your OS (Windows: Microsoft C++ Build Tools; macOS: Xcode Command Line Tools; Linux: the WebKitGTK, GTK, and AppIndicator development packages required by Tauri).
- Windows 10 version 1709 (build 16299) or later for the Windows app. The installer downloads the Microsoft Edge WebView2 Runtime when needed, so internet access is required on first installation unless WebView2 is already present.
- A Google OAuth client configuration at `src-tauri/google_oauth.json` to enable Google sign-in. This file is intentionally ignored by Git and embedded into the desktop binary at build time.

## Development

```sh
npm install
npm run dev
```

Run the desktop app through Tauri:

```sh
npm run tauri dev
```

On Windows, if Tauri emits `EBUSY` watcher errors for locked Cargo output files, use:

```sh
npm run tauri:dev:quiet
```

This disables Tauri's Rust file watcher. Frontend hot reload remains available; restart the command after Rust changes.

## Checks and production build

```sh
npx tsc --noEmit
npm run build
cd src-tauri
cargo check
cargo test
```

Build an installable bundle for the current platform with:

```sh
npm run tauri build
```

On Windows, build both an NSIS setup executable and an MSI installer with:

```powershell
npm run build:windows
```

The installers are written to `src-tauri/target/release/bundle/nsis/` and
`src-tauri/target/release/bundle/msi/`. NSIS is the smaller, simple setup
option; MSI is available for managed Windows deployments. Build this command
on Windows with Node.js/npm, the Rust MSVC target, and Microsoft C++ Build Tools.
The resulting app targets Windows 10 version 1709 (build 16299) and later; the
installer downloads WebView2 when needed (internet required), while Windows 10
1803 and later generally include it with the OS.

### macOS and Linux

The same project builds on macOS and Linux; a separate application project is
not needed. On a Mac or Linux machine, install that OS's Tauri prerequisites,
then run `npm ci` and `npm run tauri build`. The bundle is created for the OS
and architecture of the machine doing the build. macOS builds need Apple signing
and notarization credentials for a trusted public release; unsigned builds may
be blocked by Gatekeeper. Linux packages require a compatible Linux distribution
and its WebKitGTK runtime dependencies.

The `Desktop installers` GitHub Actions workflow builds Windows (NSIS/MSI),
macOS (DMG), and Linux (DEB/AppImage) packages on native hosted runners, runs
Rust format/check/test steps, and saves the bundles as workflow artifacts. A
version tag (`v*`) also publishes the bundles as a GitHub Release. The workflow
must be committed to the GitHub repository that contains this desktop project;
putting it in a separate or untracked folder will not trigger the build. CI uses
a placeholder OAuth configuration so builds do not require a committed secret;
Google sign-in will not work in those packages until real credentials are
securely configured.

## Local data

The SQLite database is stored in Tauri's per-user application data directory as `eventpulse.db`. On first startup, the app attempts to migrate the prior database from the OS temp directory (`eventmanagerdesktop/eventpulse.db`) after checkpointing its WAL file. Back up the database before manually moving or removing it.

## Website sync

The app automatically pairs password sign-ins with the configured EventPulse website and pairs Google sign-ins through the website's Google auto-pair endpoint. The Rust sync worker pushes local event and work-item changes and pulls website updates while the app is running. Tasks, agenda sessions, and file metadata synchronize across paired devices; file contents transfer in authenticated 256 KiB chunks (files up to 20 MB). Changes remain in the local outbox when the website is unreachable. Sync requires the website deployment to provide the matching `/api/sync/auto-pair`, `/api/sync/auto-pair-google`, `/api/sync/push`, `/api/sync/pull`, and `/api/sync/work` endpoints. Pairing and sync status are shown in the appbar.

Event owners can duplicate an event (including its agenda and open task checklist) and download a calendar `.ics` file from event details. Owners and event admins can rename files. Desktop sync includes event tasks, agenda entries, and files for accessible events.

## Troubleshooting

- **Database startup error:** Check that the OS permits writes to the application's user data directory. The startup screen displays the database initialization error.
- **Not paired / pairing issue:** Confirm the website is deployed with the automatic pairing routes and that the desktop and website accounts use the same email. Sign out and sign in again after deploying website changes.
- **Sync issue:** Check the appbar status message and network access to the production website. Local event changes stay in the SQLite outbox until a successful push.
- **Google sign-in configuration:** Confirm `src-tauri/google_oauth.json` has a valid OAuth client configuration and that the OAuth redirect URI allows `http://localhost:17927/callback`.
