# 14. Guided `gh` CLI setup as the primary desktop GitHub connection — install + inline-terminal auth, on a reusable host-tool setup step

Date: 2026-07-03

Status: Accepted (softens ADR 0008)

## Context

ADR 0008 gave the local desktop build GitHub API access behind the
`getGitHubToken()` seam: a fixed resolver order of (1) the host `gh` CLI's
token, (2) a stored device-flow token, (3) `null` ("API features dark"), plus a
no-auth floor (add a Repo by clone URL or local folder) that never needs a
token. It treated `gh` **passively** — "the zero-config path for anyone who
already uses `gh`" — and made the **device flow** the active, on-demand connect,
drawing a hard line: "the app never touches the CLI's own auth."

Two gaps show up on a real first launch:

- A fresh install with no `gh` and no `SCREENPLAY_GITHUB_CLIENT_ID` falls
  straight to the no-auth floor. The device-flow connect requires that client id
  baked into the installer; unset, "the connect affordance simply doesn't offer
  itself" (0008's own consequence), so there is **no in-app way to light up the
  GitHub API** at all.
- The only connect UI is a device-flow dialog buried in the repo picker
  (`repo-picker.tsx`), gated on `deviceFlowConfigured`. There is no Settings
  home for the connection.

Meanwhile the desktop "no harness detected" terminal banner already points users
at a not-yet-built **"manage harnesses from Settings"** surface
(`lib/agent/harnesses/index.ts`). A harness needs the same treatment as `gh`:
install a CLI, then authenticate it in a terminal. The two are the same shape.

## Decision

- **A GitHub section in desktop Settings, with guided `gh` as the primary
  path.** It reads `getGitHubLocalStatus().tokenSource` and drives the host
  `gh` CLI actively: **detect** (extend the `gh` adapter to distinguish *not
  installed* from *installed-but-logged-out*, which it collapses to `null`
  today), **install** with one click, and run `gh auth login --web
  --git-protocol https` (scope `repo`, matching the device flow) in an **inline
  terminal**. The device flow stays as a fallback, offered only when
  `deviceFlowConfigured`.

- **Install: Homebrew if present, else the official binary.** `brew install gh`
  when `brew` is on `PATH`; otherwise `curl` GitHub's official
  `gh_*_macOS_arm64` tarball and extract `gh` into `~/.local/bin` — no `sudo`,
  a deterministic path, and already on the sidecar's augmented `PATH`
  (`desktop/src-tauri/src/sidecar.rs`). This mirrors the existing ttyd/tmux
  static-binary pattern (`lib/sandbox/terminal.ts`). Detection runs first, so an
  already-installed `gh` never triggers a download.

- **Soften 0008's "never touches the CLI's own auth" to one-directional help.**
  The app now helps you sign **in** (install + `gh auth login`) but never signs
  you **out** — no `gh auth logout`. "Disconnect" still clears only the app's
  stored device-flow token. A `gh` login is the user's, used outside the app
  too, so the app never destroys it. (Glossary updated: `apps/app/CONTEXT.md`,
  **GitHub Connection**.)

- **Extend the terminal to a sandbox-less host session.** The node-pty registry
  already runs host processes with the host env (`lib/terminal/local/pty.ts`);
  the local WS bridge just hard-requires `?sandbox=` for its cwd
  (`lib/terminal/local/server.ts`). Factor the hardened xterm + ttyd-protocol
  core out of `TerminalTab` into a shared pane, and add a **host-session**
  wrapper (cwd `$HOME`, no room / sandbox / membership-credential gate) for
  Settings. Completion signal = **PTY exit → re-detect** status.

- **Shape it as a reusable host-tool setup step** — `{ detect installed, detect
  authed, install, auth-in-terminal, re-detect }` — so the deferred harness
  detection/setup Settings reuse the same primitive. `gh` is the first instance.

- **The repo picker stops owning connect UI.** Its inline device dialog becomes
  a "Connect GitHub in Settings →" deep-link; Settings is the one canonical
  connection home. The pointer shows whenever `tokenSource === null` on the
  local build — no longer gated on `deviceFlowConfigured`, because the `gh` path
  needs no client id.

### Considered and rejected

- **Device flow as the primary path** (0008's choice): needs a client id baked
  into the installer and leaves the token only in the app's store, not the
  user's own CLI. Kept as a fallback, not the front door.
- **`gh auth login --with-token` fed non-interactively** (from the app's device
  flow): contradicts the visible-terminal UX the feature is about, and fights
  `gh`'s TTY expectation.
- **Homebrew-only install**: fails with no `brew`, and recovering ("go install
  Homebrew first") is a poor one-click. The binary fallback always works.
- **Full `gh` management (offer logout)**: destroys an auth the user may rely on
  in their own shell; reverses the 0008 principle instead of bending it.
- **Bending `TerminalTab` to be sandbox-optional**: risks regressing the Branch
  terminal for a use case it was never shaped for. Extracting a shared core is
  the DRY move without that risk.

## Consequences

- The app now installs/updates `gh` when it's absent — we own that version (an
  old `gh` still runs `auth login` / `auth token` fine, so the stakes are low).
  A `brew` user who lacks `gh` gets a brew-managed copy; everyone else gets a
  `~/.local/bin` binary the augmented `PATH` resolves.
- The device flow degrades to a deep edge fallback (offline, or an install that
  fails) — and remains the only path when the user declines `gh`.
- A dormant device-flow token can sit *under* a `gh` connection (the resolver
  prefers `gh`), so "disconnect" visibility must key on *a device token exists*,
  not on `tokenSource` — `getGitHubLocalStatus` should report that additively.
- The shared terminal core is used by two mounts (the Branch terminal and the
  host session); xterm bugs get fixed once. The host session deliberately
  bypasses the room/credential gate — safe only because it is `127.0.0.1`
  desktop-local, the same trust boundary the local terminal transport already
  relies on.
- The later harness-setup slice inherits this primitive but still has to solve
  what `gh` sidesteps: an **authenticated** harness probe (`HarnessStatus` is
  `installed`-only today), an `npm install -g` path on a host that may lack
  `npm`, and **live re-probe** to replace the per-launch memoized detection (and
  its "restart Screenplay" requirement).
