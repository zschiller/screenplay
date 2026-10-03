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

- **Boot runs off the main thread** (`boot` in `main.rs`), so the window paints
  `dist/index.html` immediately: the logo on the app's theme background, a
  spinner only after ~0.8s, and an error state (`window.showBootError`) if the
  sidecar dies or never answers.
- **Port** is OS-assigned (`TcpListener::bind("127.0.0.1:0")`) and handed to the
  sidecar; the first-paint race is closed by gating `navigate()` on `/api/health`.
- **The single build-time switch** lives in [`desktop.env`](./desktop.env): the
  one place every local backend is selected together. `scripts/build-sidecar.mjs`
  applies it at `next build`; the shell re-applies the runtime half at spawn.
- **Secrets** (`ENCRYPTION_KEY`, `TERMINAL_AUTH_SECRET`)
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
installer are handled by the release script — see below.)

## Releasing

The root `ci.yml` never touches this package (no `test`/`typecheck` scripts —
the only artifact is the build), and there's deliberately no per-PR build
check: a full sidecar + Tauri build needs a macOS runner (10x billed minutes),
which isn't worth paying for until the app is release-ready. The build is
exercised when a release is cut:

- **`pnpm --filter desktop release <patch|minor|major|X.Y.Z>`**
  (`scripts/release.mjs`), run on a Mac: bumps the version across
  `package.json` / `tauri.conf.json` / `Cargo.toml`, builds a **Developer
  ID-signed and notarized dmg**, verifies it with Gatekeeper, then commits the
  bump, tags `desktop-v<version>` and publishes a GitHub Release with the dmg
  attached (via `gh`) under its versioned name and as `Screenplay.dmg`, which
  the homepage's Download buttons fetch via `releases/latest/download/`.
  The notes are a readable changelog drafted before the build from the merged
  PRs that change the app (`claude -p`, reviewed in the terminal), or the
  Markdown file passed as `--notes <file>`. Signing and notarization read `APPLE_*` variables from a
  gitignored `.env.release` (see `.env.release.example`). The optional
  `SCREENPLAY_GITHUB_CLIENT_ID` is compiled into the shell (`option_env!` in
  `sidecar.rs`) to enable the "Connect GitHub" device flow in released builds.
  Needs Node 23+ (the script imports TypeScript directly) and a clean tree.

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
