# Screenplay desktop shell

The Tauri shell that turns the per-seam local backends into a single offline
desktop app (issue #418, PRD #404). It wraps the Next app — run as a bundled
**Node sidecar** — in a native window, and owns the sidecar's lifecycle.

## How it works

```
Tauri shell (Rust)                         Node sidecar (Next standalone)
─────────────────                          ──────────────────────────────
pick free 127.0.0.1 port  ───PORT────────▶ next start (server.js)
mint/persist secrets      ───env─────────▶ ENCRYPTION_KEY, *_SECRET
inject desktop profile    ───env─────────▶ SANDBOX_BACKEND=local,
                                            SCREENPLAY_DB=pglite,
                                            BLOB_STORE=local-fs,
                                            NEXT_PUBLIC_YJS_HOST=local,
                                            AGENT_ENGINE=external …
poll /api/health ─────────────────────────▶ 200 OK
navigate(webview) ───────▶ http://127.0.0.1:<port>/
on quit: kill + wait child
control server (thumbnails) ◀──POST /thumbnail── TauriWebviewCapturer
```

- **Port** is OS-assigned (`TcpListener::bind("127.0.0.1:0")`) and handed to the
  sidecar; the first-paint race is closed by gating `navigate()` on `/api/health`.
- **The single build-time switch** lives in [`desktop.env`](./desktop.env): the
  one place every local backend is selected together. `scripts/build-sidecar.mjs`
  applies it at `next build`; the shell re-applies the runtime half at spawn.
- **Secrets** (`ENCRYPTION_KEY`, `THUMBNAIL_RENDER_SECRET`, `TERMINAL_AUTH_SECRET`)
  are minted on first launch and persisted under the OS app-data dir — the
  hosted deploy gets them from deployment config; a desktop install has none.
- **Clean shutdown**: the `Child` is parked in Tauri managed state and
  killed + reaped on `RunEvent::ExitRequested` (no orphaned sidecar).

## Building the sidecar

`next build --output=standalone` traces a self-contained tree but leaves four
things out, which `scripts/build-sidecar.mjs` folds back in before packing:

1. `.next/static` + `public` — not copied by standalone (the CDN serves them
   hosted; here the sidecar does).
2. `drizzle/local/*.sql` — read from disk at runtime, so tracing misses it;
   PGlite's migrate-on-boot needs it.
3. `node-pty`'s native `prebuilds/<platform>/pty.node` — a dynamically-loaded
   `.node` the tracer doesn't follow; the terminal transport crashes without it.
4. the `node` binary itself.

The tree is packed as **`sidecar.tar.gz`**, not shipped as a directory: Next's
traced `node_modules` keeps ~275 pnpm peer-dependency symlinks, and Tauri's
resource copy drops symlinks — tar preserves them (and the `node` exec bit). The
shell extracts it once, version-stamped, into the app cache dir on first launch.

## Commands

```bash
pnpm --filter desktop build:sidecar   # next build → src-tauri/resources/sidecar.tar.gz
pnpm --filter desktop dev             # tauri dev (rebuild sidecar first)
pnpm --filter desktop build           # build:sidecar + tauri build → Screenplay.app
```

Prerequisites: the Rust + Tauri toolchain (`cargo`, system WebView), and `node`
on `PATH`. Out of scope per the PRD: auto-update. (Code signing and the dmg
installer are handled by the release workflow — see below.)

## CI and releasing

Two workflows own the desktop build (the root `ci.yml` never touches it — this
package has no `test`/`typecheck` scripts; its only artifact is the build):

- **`desktop-build.yml`** — builds sidecar + shell unsigned on a macOS runner
  for every PR/push that touches a path the desktop app embeds
  (`apps/desktop`, `apps/app`, `packages`, the lockfile), and uploads the
  `.app` as a 7-day artifact for smoke testing. Ad-hoc signed only: a
  downloaded copy needs right-click → Open past Gatekeeper.
- **`desktop-release.yml`** — manual (workflow_dispatch, knobs-style): bumps
  the version across `package.json` / `tauri.conf.json` / `Cargo.toml`, builds
  a **Developer ID-signed and notarized dmg**, tags `desktop-v<version>`,
  publishes a GitHub Release with the dmg attached, and opens a PR to sync the
  bump into `main`. Signing and notarization are driven entirely by `APPLE_*`
  secrets read by Tauri's bundler; the required secrets (and how to mint them)
  are documented in the workflow header. The optional
  `SCREENPLAY_GITHUB_CLIENT_ID` repo *variable* is compiled into the shell
  (`option_env!` in `sidecar.rs`) to enable the "Connect GitHub" device flow
  in released builds.

Apple Silicon only for now: `build-sidecar.mjs` ships the build machine's own
`node` (`process.execPath` — the official nodejs.org build, which is itself
signed), so an x86_64/universal release would first need per-arch node
download in the sidecar build.

## Thumbnails

The desktop build can't run a headless Chromium, so the sidecar's
`TauriWebviewCapturer` POSTs render URLs to the shell's localhost **control
server** (`TAURI_CONTROL_URL`), which renders them in a webview and returns PNG
bytes. The webview-screenshot primitive is the one piece spike #407 did not
de-risk; see `src-tauri/src/thumbnail.rs`.
