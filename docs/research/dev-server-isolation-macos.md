# Running a prototype's dev server isolated on macOS

Research for issue #990 ("How can a prototype's dev server run isolated on macOS?"), part of the map in issue #988 (Wayfinder: Share a room from the Mac). Researched 2026-09-28.

## Question

On desktop, a Branch's dev server (and its setup script) runs as a host process with the user's full permissions (ADR 0007: "a single trusted local operator"). The prototype code is unreviewed and often agent-written, so a bug or a malicious dependency can read `~/.ssh`, the `gh` token or anything else in `$HOME`, and can talk to anything on the network. The ticket compares three ways to contain it:

- Seatbelt (`sandbox-exec`), as Claude Code and Codex use it
- Apple's `container` (macOS 26)
- Docker / OrbStack

For each: HMR and file watching, native deps, startup and memory cost, filesystem limits and credential blocking, network egress control, what the user installs, deprecation or macOS-version ties, and where it plugs in.

## How sure this is

Web fetches were not available in this session. Every claim below is one of:

- **Verified**: read in a primary source that was checked out locally. Those sources are pinned here:
  - `SRT` = [anthropic-experimental/sandbox-runtime@3ed9739](https://github.com/anthropic-experimental/sandbox-runtime/tree/3ed97390547bdd3d5cec5097d123f3a5fb741c6b) (package `@anthropic-ai/sandbox-runtime` 0.0.77), the library Claude Code's sandbox is built on (its README says so and links to the [Claude Code sandboxing docs](https://docs.claude.com/en/docs/claude-code/sandboxing))
  - `CX` = [openai/codex@e07e58c](https://github.com/openai/codex/tree/e07e58c8429019de78b138d7138deaaf7f3ef22c), `codex-rs/sandboxing/src/`
  - `AC` = [apple/container@2e23485](https://github.com/apple/container/tree/2e23485f62e6217be4e00c3cf23a4f1675875bcf)
  - this repo at the current checkout
- **Unverified (from memory)**: marked inline. This covers everything about Docker Desktop and OrbStack, macOS man pages, and framework watcher behavior (Next, Vite, Watchpack, chokidar). The spike proposed at the end should confirm these before anything is specced.

## Where the dev server runs today (repo facts)

- `launchDevAndProxy` (`apps/app/lib/sandbox/provision-internals.ts:270`) starts two restart-on-crash supervisors through `sandbox.runCommand`, each as a session leader so `stopDevAndProxy` can group-kill it (`:214`):
  - **Dev server.** On the local backend the command is `node <portless>/dist/cli.js run --app-port <devPort> sh -c '<dev script>'` (`:335-338`, ADR 0010). Portless puts `$PORT` in scope and registers a `.localhost` route.
  - **Bridge proxy.** `node ~/.screenplay/proxy.mjs` binds `0.0.0.0:<proxyPort>` and upstreams to `127.0.0.1:<devPort>` (`apps/app/lib/sandbox-bridge/proxy.mjs:157`). This is our code, not prototype code.
- The **setup script** (default `npm install`) runs before that through the user's login shell, `$SHELL -ilc '<setup>'` (`apps/app/lib/sandbox/provision.ts:35-66`). It is just as untrusted: `postinstall` scripts run arbitrary code.
- `LocalSandboxProvider.runCommand` is a plain host `spawn` with `cwd` = the worktree (`apps/app/lib/sandbox/local/provider.ts:450-460`, `execHost` at `:500`). The same `runCommand` also serves the agent's tools, git, and harness installs, which need the user's real credentials (ADR 0007, `usesHostGitAuth`).
- Worktrees live under `SCREENPLAY_WORKTREE_ROOT`, by default `~/.screenplay/worktrees` (`local/provider.ts:44-49`). For a `local-path` repo source, the worktree's `.git` points back into the user's own checkout (`local/provider.ts:27-33`). A sandbox that denies reads outside the worktree must still allow that git dir, or dev tools that shell out to `git` break.
- Other loopback services a sandboxed process could reach:
  - the terminal WebSocket, on `127.0.0.1` with an ephemeral port and no auth, where `?host=1` opens a PTY in `$HOME` (`apps/app/lib/terminal/local/server.ts:74-95`, `:154`)
  - the Yjs server on `:1234` (`apps/app/lib/yjs-host/y-websocket-server.ts:17`, `:222`)

  This matters for Seatbelt below.

## Option 1: Seatbelt (`sandbox-exec`)

### How Claude Code and Codex use it

- **Claude Code / `srt`.** `srt` wraps any command in a Seatbelt profile it generates, plus host-side HTTP and SOCKS proxies (SRT `README.md`, "How It Works").
  - The profile starts with `(deny default)`. It then allows `process-exec`/`fork`, a fixed list of `mach-lookup` services, including `com.apple.SecurityServer` and `com.apple.securityd.xpc`, and the configured file rules (SRT `src/sandbox/macos-sandbox-utils.ts:968-1003`, `:1122-1123`).
  - **Reads** are allowed everywhere unless denied. `denyRead` and `allowRead` combine, so `denyRead: ["/Users"], allowRead: ["."]` gives workspace-only reads. **Writes** are denied unless allowed. Globs work on macOS (SRT README, "Filesystem Configuration").
  - **Network** is denied by default. The profile only lets the process reach the local proxy ports, and the proxies enforce a domain allowlist and denylist. The proxies also refuse allowlisted hostnames that resolve to loopback, link-local, metadata or the host's own addresses (SRT README, "Network Isolation", "Resolved-address check").
  - `srt` runs as a CLI (`srt -c '<cmd>'`, `srt --settings <file> …`; SRT `src/cli.ts:273-283`) or as a library (`SandboxManager.wrapWithSandbox`). It needs Node >= 20.11 (SRT `package.json`). It invokes `/usr/bin/sandbox-exec` (`macos-sandbox-utils.ts:1478`).
- **Codex.** Codex also shells out to `/usr/bin/sandbox-exec`, only from `/usr/bin` so a PATH-planted copy can't be used (CX `seatbelt.rs:58-62`).
  - Its base policy is also `(deny default)`, modeled on Chrome's renderer policy (CX `seatbelt_base_policy.sbpl`).
  - Its default read policy is **full-disk read**: `has_full_disk_read_access()` is true for both read-only and workspace-write (CX `codex-rs/protocol/src/protocol.rs:1222-1237`, tests at `:5045`, `:5056`). Codex out of the box confines writes and network, not reads of `~/.ssh`.
  - Network is all or nothing, or proxy-routed. With "local binding" on, it allows bind to `*:*` and outbound to `localhost:*` (CX `seatbelt.rs:334-339`).

### Answers

| Question | Answer |
|---|---|
| HMR and file watching | **Likely yes, needs a spike.** It is the same host filesystem, so there is no event-propagation problem. Two things to check: (1) the dev server must **bind** its port, which needs `allowLocalBinding`. That rule adds `network-bind`/`network-inbound` on `*:*` and outbound to `localhost:*` (SRT `macos-sandbox-utils.ts:1159-1170`). (2) The macOS FSEvents API talks to the `com.apple.FSEvents` mach service. It is **not** in srt's `mach-lookup` allowlist (`:986-1003`), and neither srt nor Codex mentions it anywhere. Watchers built on FSEvents (the `fsevents` addon, and libuv's `fs.watch` on directories) may fail or fall back to polling. *Unverified (from memory): libuv uses FSEvents for directory watches on macOS; Watchpack/chokidar fall back to polling when native watching fails.* srt documents a related case: watchman has to be turned off (SRT README, "Running Jest"). |
| Native deps | **Yes.** Same OS, same arch, same `node_modules` the host `npm install` built. There is no cross-OS rebuild. |
| Startup / memory | **Close to zero.** One `sandbox-exec` exec that compiles the profile, plus the srt proxy processes (Node). srt notes that profile size affects compile time (`macos-sandbox-utils.ts:585`, `:716`). No VM. *Unverified: overhead is in the tens of ms.* |
| Filesystem limits / credentials | **Yes for files.** Deny reads on `$HOME` (or `/Users`), then re-allow the worktree, its git dir, and the toolchain (node or nvm, the pnpm or npm cache). Allow writes only to the worktree and the temp and cache dirs. `~/.ssh` and `~/.config/gh` are then unreadable. **Keychain is a gap:** srt's profile allows `com.apple.SecurityServer`/`securityd.xpc` (`:999`, `:1123`). *Unverified (from memory): `gh` stores its token in the login keychain through `/usr/bin/security`, and the item's ACL trusts that binary, so a sandboxed `security find-generic-password` may read the token without a prompt.* A Screenplay profile should drop those mach services and deny `~/Library/Keychains`, and the spike should test this. |
| Network egress | **Yes, by domain**, through srt's proxies (allowlist, denylist, resolved-address guard). **Big caveat for dev servers:** `allowLocalBinding` also allows outbound to *any* loopback port (`:1167-1170`, and the same in Codex). A sandboxed dev server could then open `ws://127.0.0.1:<terminal port>/?host=1` and get an **unsandboxed shell in `$HOME`**, or write to the Yjs doc on `:1234`. The fix is either a Screenplay-generated profile that allows bind/inbound only on the dev port and outbound only to the srt proxy ports (Seatbelt accepts `(remote ip "localhost:<port>")`, as srt and Codex both emit), or auth on those local services, or both. *Unverified: whether Next 16 dev opens internal loopback connections between its own processes that such a tight rule would break.* |
| Install | **Nothing for the user.** `/usr/bin/sandbox-exec` ships with macOS, and `srt` is an npm dependency bundled with the sidecar. |
| Deprecated / version-tied | **Deprecated in name, not tied to a version.** *Unverified (from memory): the `sandbox-exec(1)` man page has marked it DEPRECATED for many macOS releases, and Apple documents neither the profile language nor the tool.* It still ships and is load-bearing for Chrome, Codex (CX `seatbelt_base_policy.sbpl` cites Chromium's `.sb` files) and Claude Code. The risk is that Apple removes or changes it with no replacement. srt already works around quirks (for example, a 1025-byte string-literal limit at `macos-sandbox-utils.ts:551`). |
| Where it plugs in | **A wrapper inside `launchDevAndProxy`** (and around the setup script), local backend only. See "Where it plugs in" below. |

## Option 2: Apple `container`

### Answers

| Question | Answer |
|---|---|
| HMR and file watching | **Uncertain, likely needs polling.** Host folders are shared with `--volume`/`--mount`, and the default mount type is **virtiofs** (AC `Sources/Services/ContainerAPIService/Client/Parser.swift:336-341`). The docs and source say nothing about inotify on those mounts: grepping AC for `inotify`/`fsnotify` finds nothing. *Unverified (from memory): edits made on the host through Virtualization.framework virtiofs do not reliably raise inotify events in the guest, so Next needs `WATCHPACK_POLLING=true` and Vite needs `server.watch.usePolling`, at a CPU cost.* HMR itself (the WebSocket) works through a published port. |
| Native deps | **Not the host's.** The guest is Linux arm64, so the `darwin-arm64` binaries in the host-installed `node_modules` (esbuild, SWC, lightningcss, sharp) won't load. `node_modules` has to be installed **inside** the container, ideally on a named volume ("better I/O performance than a bind mount", AC `docs/volumes.md:36-38`) that shadows the worktree's `node_modules`. The setup script then moves into the container too. |
| Startup / memory | **One VM per container.** Each container is "a lightweight VM" with "boot times that are comparable to containers running in a shared VM" (AC `docs/technical-overview.md:26-30`). The default limit is **1 GiB RAM and 4 CPUs per container** (AC `docs/resource-usage.md:8`). Memory freed inside the guest is **not returned to macOS** until the container restarts (`technical-overview.md:55-59`), which hurts long-running Next dev servers. *Unverified: boot is sub-second to a few seconds; an image pull on first use takes longer.* |
| Filesystem limits / credentials | **Strongest of the three.** The guest sees only what is mounted: the worktree, its git dir if needed, and optionally read-only mounts (`--mount …,readonly`, `--read-only`, AC `docs/command-reference.md:62-78`). `~/.ssh`, the keychain and `gh` config aren't reachable at all. |
| Network egress | **Coarse.** `-p 127.0.0.1:<host>:<container>` publishes the dev port to host loopback (AC `docs/networking.md:88-95`). `container network create --internal` makes a host-only network with no egress (`docs/command-reference.md:805`, **macOS 26+**, `:785-787`). There is no per-domain allowlist, so that would mean an internal network plus a host-side proxy (for example, srt's proxy) as the only way out. The guest can reach host services through the vmnet gateway unless those are bound to `127.0.0.1` only. The terminal server is, but the Yjs server and bridge proxies bind all interfaces. |
| Install | A signed `.pkg` from GitHub releases, installed with an **admin password**, then `container system start` launches a launch agent (AC `README.md`, "Initial install"). Plus an OCI image (for example, `node:22`) on first use. |
| Deprecated / version-tied | **Apple silicon only and macOS 26 only** ("We do not support older versions of macOS", AC `README.md`, "Requirements"). It runs on macOS 15 with limitations, such as no `container network` commands and no container-to-container traffic (`technical-overview.md:61-77`). It is young, pre-1.0, and moving fast. |
| Where it plugs in | Either a runner behind the same `launchDevAndProxy` wrapper seam, or a whole `SandboxProvider`. See below. |

## Option 3: Docker Desktop / OrbStack

No primary source was reachable for these in this session. The whole column is **unverified (from memory)**.

| Question | Answer |
|---|---|
| HMR and file watching | Both run one shared Linux VM and share host folders into it (Docker Desktop uses VirtioFS by default on recent versions; OrbStack uses its own virtiofs-based sharing). Both say they forward host file-change events into the VM, so inotify-based watchers mostly work without polling. Reports of missed events on large trees still exist, and `WATCHPACK_POLLING` is the usual fallback. |
| Native deps | The same Linux-guest problem as `container`: install `node_modules` inside the container, on a volume. |
| Startup / memory | The VM is started once and shared, so each container starts in about a second. The VM reserves a few GB (Docker Desktop defaults to about half of host RAM as a ceiling; OrbStack allocates dynamically and returns memory). Bind-mount I/O is slower than native, and `node_modules` on a bind mount is the classic slow path. |
| Filesystem limits / credentials | Good. The container sees only its mounts. Docker Desktop shares `/Users` into the VM by default, but a container still sees only what it mounts. |
| Network egress | `--network none`, or internal networks, for no egress. There is no built-in domain allowlist, so you'd need a proxy container or an egress firewall. Docker's paid Enhanced Container Isolation hardens the VM boundary but is not an egress allowlist. |
| Install | A separate app the user installs and keeps running. Docker Desktop needs a paid subscription for larger companies. OrbStack is paid for commercial use. Either is a large ask for a desktop app's first run. |
| Deprecated / version-tied | Maintained. Supports several recent macOS versions and both Intel and Apple silicon. |
| Where it plugs in | As for `container`. ADR 0003 already names "a local Docker driver" as a future `SandboxProvider`. |

## Comparison

| | Seatbelt via `srt` | Apple `container` | Docker / OrbStack |
|---|---|---|---|
| Boundary | Kernel sandbox around host processes | A VM per container | One shared VM |
| HMR / watching | Native FS; FSEvents mach-lookup needs a spike | virtiofs, probably polling *(unverified)* | Event forwarding, mostly works *(unverified)* |
| Host `node_modules` / native deps | Work as is | Linux rebuild inside the container | Linux rebuild inside the container |
| Added startup | About 0 | VM boot per Branch | About 1 s once the VM is up *(unverified)* |
| Added memory | About 0 plus the proxy | Up to 1 GiB per Branch by default, not returned | Shared VM of several GB *(unverified)* |
| Blocks `~/.ssh`, `gh` config | Yes, with `denyRead` | Yes, never mounted | Yes, never mounted |
| Blocks keychain | Only if SecurityServer is removed from the profile (spike) | Yes | Yes |
| Blocks our loopback services | Only with a Screenplay-tightened profile | Partly: the guest reaches services on `0.0.0.0` | Partly *(unverified)* |
| Egress by domain | Yes (srt proxy) | No, only on/off (`--internal`), plus a proxy | No, only on/off, plus a proxy *(unverified)* |
| User installs | Nothing | An admin `.pkg` plus a service and an image | A third-party app, possibly paid |
| OS / hardware | Any supported macOS | macOS 26 and Apple silicon | Broad |
| Longevity risk | Tool deprecated in name, undocumented | Young, pre-1.0 | Low |
| Fits ADR 0007/0009 (host worktree, host auth) | Yes, same processes with less power | Partly: split filesystem and install | Partly: split filesystem and install |

## Where it plugs in

Two seams exist.

1. **A dev-process runner inside `launchDevAndProxy` (recommended).** Only the *untrusted* processes get contained: the dev script and the setup script. The agent, git, harness installs and terminal stay host processes with host auth, as ADR 0007 decided.
   - **Dev server.** Wrap the inner command, keeping portless outside. Portless is our trusted tool and writes its own state, so its `sh -c '<dev>'` becomes `srt --settings <per-sandbox file> -c '<dev>'` at `provision-internals.ts:335-338`. The supervisor loop, pidfile and group-kill (`:350-373`, `:214`) keep working, because srt is a child in the same process group. The bridge proxy (`:376-392`) stays unsandboxed.
   - **Setup script.** Wrap `$SHELL -ilc '<setup>'` the same way in `installDependencies` (`provision.ts:57-60`), with the npm, pnpm and yarn registries on the allowlist.
   - **Settings.** Write the srt settings per Sandbox next to the log, in `sandboxStateDir` (`provision-internals.ts:43`). They include the worktree path and git dir from `sandbox.worktreePath` and `meta/<name>.json`.
   - **Switch.** A desktop env flag (for example, `DEV_SERVER_ISOLATION=seatbelt|off` in `apps/desktop/desktop.env`, which gets documented in `apps/docs/content/self-hosting/environment-variables.mdx`) keeps it switchable, in the same pluggable-by-env style as `SANDBOX_BACKEND`. A container runner could later sit behind the same seam.
2. **A new `SandboxProvider` (ADR 0003 / 0007).** This is the right seam only if *everything* for a Branch moves into the box: agent tools, git, terminal. That reopens what ADR 0007 closed: brokered git auth instead of host auth (`usesHostGitAuth`), the terminal transport, and `worktreePath`/`homeDir` pointing inside a VM. A `container` or Docker provider would also have to reimplement `hostPort`/`domain` over published ports. That is a much bigger change, and the dev-server risk doesn't need it.

## Recommendation

**Start with Seatbelt through `@anthropic-ai/sandbox-runtime`, wrapped around the dev script and the setup script inside `launchDevAndProxy` / `installDependencies`, behind a desktop env switch.** It costs nothing to install and almost nothing at runtime. It keeps host-built native deps and native file watching. It is the only option with per-domain egress. It is the mechanism Claude Code and Codex already ship on macOS. Keep Apple `container` as a later opt-in "strict" runner behind the same seam for macOS 26 users, once its file-watching story is confirmed. Don't take on Docker/OrbStack as a dependency.

Two conditions, which a short spike (a `prototype` ticket) should settle before this is specced:

1. **Close the loopback hole.** srt's `allowLocalBinding` allows outbound to every localhost port, so the sandboxed dev server could reach the unauthenticated terminal WebSocket (`?host=1` opens a host shell) and the Yjs server. Use a profile that allows bind/inbound on the dev port and outbound only to srt's proxy ports, or authenticate those services, or both. Separately, the *browser-side* prototype JS in the iframe is not covered by any of these sandboxes, and it can also try `ws://127.0.0.1:<port>`. Terminal-socket auth is worth doing regardless.
2. **Test on a real Mac:**
   - `next dev` and `vite` HMR under the profile, and whether `com.apple.FSEvents` must be allowed
   - whether the keychain (`security find-generic-password -s gh:github.com`) is readable with srt's default SecurityServer allowance
   - whether a `$HOME` read-deny breaks nvm, corepack or pnpm-store paths
