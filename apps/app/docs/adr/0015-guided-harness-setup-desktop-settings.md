# 15. Guided harness setup as a desktop Settings surface — per-harness install + inline-terminal sign-in + live re-probe, on the reusable host-tool setup step

Date: 2026-07-03

Status: Accepted (extends ADR 0014; realizes the harness slice ADR 0014 deferred)

## Context

ADR 0014 built a **reusable host-tool setup step** (`lib/host-tool/setup-step.ts`)
— a pure state machine over `{ detect installed, detect authed, install,
auth-in-terminal, re-detect }` — and made `gh` its first instance: a desktop
Settings section that installs `gh` and runs its sign-in in a visible inline
**host-session terminal** (`HostSessionTerminal` + `/api/terminal/host`), then
re-detects. Its closing consequence named the sibling this ADR realizes:

> The later harness-setup slice inherits this primitive but still has to solve
> what `gh` sidesteps: an **authenticated** harness probe (`HarnessStatus` is
> `installed`-only today), an `npm install -g` path on a host that may lack
> `npm`, and **live re-probe** to replace the per-launch memoized detection (and
> its "restart Screenplay" requirement).

The desktop world today: the **Harness Availability** seam
(`lib/agent/harnesses/availability.ts`) folds the one catalog into "which
harnesses can this deployment offer". Its desktop resolver
(`createDesktopResolver`) probes each descriptor's `hostBinary` on the host
`PATH` (`host-binary.ts`), **once per app launch and memoized** — a freshly
installed CLI only shows up after a restart, by design. `HarnessStatus` carries
`installed` only. There is no in-app way to install a harness or sign it in: the
"no harness detected" terminal banner (`unconfiguredBannerArgv("desktop")`) tells
the user to install a CLI on their `PATH` **and restart Screenplay**, pointing at
a "manage harnesses from Settings" surface that doesn't exist yet.

So a fresh desktop install with no coding CLI has the same first-launch gap `gh`
had: the agent panel is dark, and the only guidance is "go install something
yourself, then restart." A harness needs exactly `gh`'s treatment — install a
CLI, then authenticate it in a terminal — but three things differ, and each is a
real decision rather than mechanical reuse:

1. **Auth is not a uniform probe.** `gh` answers "am I signed in?" with
   `gh auth token`. Each harness rides *its own* login with no shared command —
   Claude Code's stored OAuth credential, `codex login`'s `auth.json`,
   `opencode auth login`'s provider store. `HarnessStatus` has no auth fact.
2. **Install has no `npm` guarantee.** Harnesses publish an `installPackage` for
   `npm install -g`, but the desktop host may have no `node`/`npm` at all. `gh`
   dodged this with brew-or-static-binary; a harness needs a path that never
   dead-ends on a missing `npm`.
3. **Detection is memoized for the launch.** After a connect, the Settings
   surface — *and* the model dropdown and new-tab picker that read the same seam
   — must reflect the new CLI without a restart. `gh`'s resolver re-reads live
   every time; the harness resolver caches.

## Decision

- **A "Coding agents" section in desktop Settings, one guided setup step per
  harness.** It reuses `setupReducer` verbatim (the machine is tool-agnostic):
  each harness row is its own instance, mapping a live status to the reducer's
  `DetectionResult` (`not-installed` / `installed-not-authed` / `authed`) exactly
  as the `gh` panel's `detectionResult()` does. From not-installed, one button
  **installs then signs in** in a single inline host-session terminal; a
  signed-out CLI just signs in; an authed CLI offers only a secondary **re-run
  sign-in**. The section is `isLocalBuild`-gated, a sibling `<Section>` beside the
  GitHub one in `settings-view.tsx`.

- **The desktop list is the distinct installable CLIs, deduped by `hostBinary`.**
  The two opencode slots (`opencode-gateway`, `opencode-compat`) share one binary,
  one install, one login — a hosted broker-provider distinction with no meaning on
  desktop. The setup surface collapses them to one **opencode** row, the same way
  detection already probes `opencode` once (`detectInstalledHarnessKeys`). Claude
  Code and Codex are their own rows.

- **Per-harness auth probe on the descriptor.** Extend `Harness` with an optional
  `probeAuth` adapter, modeled on `GhCli.getStatus` — an **injected process
  runner** seam so it is unit-testable with a fake, and honest degradation: an
  indeterminate probe resolves to *not authed* (offer sign-in) rather than a false
  "connected". Each descriptor knows its own login:
  - **claude-code** — a stored Claude credential exists (the login-keychain item
    on macOS, with a `~/.claude/.credentials.json` fallback; the `~/.claude.json`
    `oauthAccount` block as a secondary signal).
  - **codex** — `~/.codex/auth.json` is present (written by `codex login`), or
    `CODEX_API_KEY` is set.
  - **opencode** — `opencode auth list` reports a configured provider (or its
    `auth.json` under the opencode data dir exists).

  `HarnessStatus` gains `authenticated: boolean | null` **additively** (the shape
  ADR 0014 left room for), where `null` = "not probed / can't tell". Listing is
  **still gated on presence, never auth** (the Harness Availability invariant): the
  auth fact is *surfaced in Settings*, never used to pre-filter the dropdown — a
  detected-but-signed-out harness still lists and fails loud at turn time with the
  CLI's own login message.

- **Per-harness install-command builder, npm-free by preference.** Extend `Harness`
  with an optional pure `buildInstallCommand(hostFacts) → string`, the sibling of
  `gh-install-command.ts`, mapping `{ npmPresent, brewPresent, arch }` → the shell
  command the inline terminal runs. It **prefers the vendor's own no-`npm`
  installer** so a host without `npm` never dead-ends, falling back to
  `npm install -g <installPackage>` only when `npm` is present:
  - **claude-code / opencode** ship official `curl … | bash` installers that land
    a binary in the sidecar's augmented `PATH` (`~/.local/bin`), the same
    `~/.local/bin` deterministic-path move `gh`'s binary fallback uses — no `sudo`.
  - **codex** — `brew install codex` when brew is present, its official
    `macOS arm64` release binary otherwise, or `npm i -g @openai/codex` when `npm`
    is present.

  A `npmPresent` probe reuses the exact `command -v` prober `probeHomebrewPresent`
  already leans on (`host-binary.ts`), the sibling brew fact ADR 0014 introduced.
  Install chains straight into the sign-in in one terminal session (`… && <auth>`),
  exactly like `buildGhInstallAndAuthArgv`, so a failed install stops before auth
  with its error still on screen and the row re-detects back to "Not installed".

- **Per-harness sign-in argv on the descriptor.** Extend `Harness` with an
  `authCommand` argv — the CLI's own interactive login run verbatim in the PTY:
  Claude Code's login, `codex login`, `opencode auth login`. The visible-terminal
  UX (a browser flow / device code shown in the terminal, not a spinner that might
  silently fail) is the CLI's, exactly as `gh auth login --web` was. PTY exit is
  the completion signal → re-detect.

- **Live re-probe replaces the launch memoization for the connect path.** The
  Settings surface reads a **fresh** status each time through a new server action
  (`listHarnessSetupStatus()`), never the launch-memoized resolver — so a connect
  that just finished is reflected without a restart. And on a successful connect it
  **invalidates** the shared `harnessAvailability` desktop resolver's memo (add an
  `invalidate()` to the resolver; the memo stays the default for the hot path), so
  the model dropdown and new-tab picker re-probe on their next read. This retires
  the "restart Screenplay" requirement; `unconfiguredBannerArgv("desktop")` is
  updated to point at the now-built Settings surface without the restart line.

- **One-directional help, extending ADR 0014's principle to harnesses.** The app
  helps you **install** a harness and **launch its sign-in**, but never signs you
  **out**, never uninstalls, and never manages the CLI's credentials beyond
  launching its own login — the same "help in, never out" stance the GitHub
  Connection took toward the `gh` CLI's own auth. A harness login is the user's,
  used outside the app too.

### Considered and rejected

- **A shared `harness auth token`-style probe** (one uniform command like `gh`):
  no such command exists across Claude Code, Codex, and opencode — each stores its
  own credential differently. A per-descriptor probe is the honest shape, and the
  catalog already generalizes per-descriptor behavior (install, seed, launch).
- **`npm install -g` as the only install path**: dead-ends on a host with no
  `node`/`npm`, the exact "never require a prerequisite" failure the `gh` binary
  fallback was built to avoid. The vendor installers are the npm-free path.
- **Gating the availability list on the new auth fact** (hide signed-out
  harnesses from the dropdown): reverses the Harness Availability invariant
  (presence lists; auth is surfaced, not pre-filtered) and would make a fixable
  "just sign in" look like "not installed". Auth is a Settings signal only.
- **Dropping the launch memoization entirely** (always probe live): re-probes the
  host `PATH` on every dropdown open for no benefit on the hot path. The memo stays;
  the connect flow busts it, and Settings reads live.
- **A separate setup state machine for harnesses**: the ADR 0014 reducer is
  deliberately tool-agnostic (two inputs: a detection result and a terminal exit).
  A second machine would be a copy; the harness rows are sibling instances.
- **Managing harness models here** (install + pick model in one surface): model
  selection already has a home (the desktop model dropdown / Harness model catalog,
  ADR 0011). This surface installs and authenticates; it does not pick models.

## Consequences

- `HarnessStatus` is now `{ installed, authenticated }`. Every existing consumer
  that reads `installed` is unchanged; only the Settings surface reads
  `authenticated`, and only to label a row — the dropdown/terminal folds ignore it,
  preserving the presence-lists-auth-surfaced invariant.
- The app installs coding CLIs it doesn't own, into `~/.local/bin` (or brew, or
  `npm`), so it owns that install's version until the user upgrades out of band —
  the same low-stakes ownership `gh` took. Auto-updating an app-installed harness
  is out of scope.
- The auth probes are best-effort and read private credential locations (a
  keychain item, an `auth.json`); a probe that can't read resolves to "signed out"
  and the worst case is offering a sign-in the user didn't strictly need — never a
  false "connected" that hides a dark agent panel.
- Live re-probe means a connect is reflected app-wide without a restart, closing
  the loop the desktop banner left open. The banner and its "restart" line go away.
- The setup step, host-session terminal, and install/auth command-builder pattern
  now have **two** instances (`gh` and harnesses); a bug in the shared pieces is
  fixed once. `gh` proved the primitive; the harness slice is the sibling it was
  shaped for, so this slice adds descriptors and a panel, not new infrastructure.
- This slice deliberately stops at the reusable step. A **gated first-run
  onboarding** that requires both a usable harness and a GitHub connection before
  the app opens is still out of scope — it composes from this step and the ADR 0014
  step; it does not replace them.
