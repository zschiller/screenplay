# 2. BYO-harness terminal — transport, egress injection, and trust boundary

Date: 2026-05-30

Status: Accepted

## Context

The owned **Engine** (Agent Loop) deliberately does not offload its turn loop to
an in-sandbox CLI — byte-perfect `ModelMessage[]` replay and shared/durable chat
outweigh adopting a harness's toolset (CONTEXT.md). That leaves a real gap: a
power user has no path to "run my own harness (Claude Code, Codex, aider) in
here." #187 fills it with a **second-class, opt-out** path alongside the Engine:
an **ephemeral in-sandbox web terminal** — a ttyd-style daemon launched via a
detached `runCommand` on a forwarded port (`domain(port)`), surfaced as a new
*terminal tab* kind in the agent panel and rendered with `xterm.js` over the
daemon's websocket. It is explicitly **not** a Chat Session: scrollback never
enters the chat-store, Postgres, or the Y.Doc.

Three feasibility unknowns and one architectural call gated the build. The
spike (#195) resolved all four against a live `@vercel/sandbox` — its go/no-go
and live results are recorded on the issue. This ADR records the decisions that
the build slices (#187's #2–#5) rest on.

## Decision

- **Transport: proxy the daemon's websocket through the server, gated by the
  existing `room_member` check — not a daemon-held one-time secret.** The proxy
  reuses `canAccess(roomId, userId)`, the same predicate behind `/api/yjs/auth`
  and Y.Doc sync, so there is one gating mechanism to reason about. It
  re-validates membership on connect (continuous authorization, not a bearer
  URL), keeps the daemon off the public internet, and makes collaborator
  co-viewing fall out of the server's existing fan-out. The cost — terminal WS
  traffic transits the Next server rather than going browser-direct to
  `domain(port)` — is negligible for a single-operator app and is the right
  trade for the auth properties. The auth model is the decision; if the
  deployment target makes a server WS proxy awkward, the fallback is a
  short-lived signed token still minted via `room_member` and re-validated on
  connect — never a static one-time secret.

- **Egress key injection is a pure function of the configured providers, with
  overwrite semantics.** Generalize today's Anthropic-only `buildNetworkPolicy()`
  (`lib/sandbox/provision-internals.ts`) into a fold over the providers registry:
  for each configured provider, one allow rule for its host plus a
  header-injection transform. This requires the `ModelProvider` interface
  (`lib/agent/providers/types.ts`) to **grow an egress descriptor** — the host
  and auth-header shape (`x-api-key` for Anthropic, `Authorization: Bearer` for
  OpenAI) are currently private to each provider's `fetch*Models`. Adding a
  provider then extends egress for free. The Vercel firewall **overwrites**
  (does not append) the injected header — confirmed live for both `x-api-key`
  and `Bearer` — so a harness's own dummy/empty key cannot collide with the
  injected one. The sandbox env carries only a dummy value (e.g.
  `ANTHROPIC_API_KEY: "brokered"`) to satisfy harnesses that gate on the var
  being set; the real key exists only in the firewall transform.

- **This is safe only under self-hosted / single-trusted-operator operation.**
  The terminal is a root shell in the sandbox holding the operator's own git
  token and reaching models on the operator's own keys via generalized egress
  injection. There is deliberately **no metering and no per-tenant key
  isolation** — acceptable only when the payer is the operator. If the app ever
  becomes multi-tenant, this must be revisited **before** shipping in that mode:
  generalized egress injection becomes a cross-tenant key-leak surface, unmetered
  spend on shared keys is no longer acceptable, and the root-shell-with-git-token
  exposure no longer holds. This boundary is a hard constraint, not a default.

## Consequences

- The build slices rest on settled ground: #2 builds the pure egress-policy
  builder (the deep, unit-tested module — providers in → allow map + overwrite
  transforms out) behind the new `ModelProvider.egress()`; #4 implements the
  server WS proxy against `canAccess`; #5 adds the terminal-tab surface.
- The `ModelProvider` interface gains `egress()` — returning the host + the
  auth-header to inject, or `null` when the provider isn't configured — so the
  builder is a pure fold over the registry:

  ```ts
  // providers/types.ts — added to ModelProvider
  egress(): { host: string; headers: Record<string, string> } | null
  //   anthropic → { host: "api.anthropic.com", headers: { "x-api-key": KEY } }
  //   openai    → { host: "api.openai.com", headers: { authorization: `Bearer ${KEY}` } }

  // generalizes provision-internals.ts:buildNetworkPolicy()
  function buildNetworkPolicy(providers: ModelProvider[]): SandboxNetworkPolicy {
    const allow = { "*": [] } // passthrough default for everything else
    for (const p of providers) {
      const e = p.egress()
      if (e) allow[e.host] = [{ transform: [{ headers: e.headers }] }]
    }
    return { allow }
  }
  ```

  The egress-policy unit test pins the policy *shape*; the firewall's overwrite
  behavior is upstream of that pure function and was settled empirically in the
  spike — both checks are needed.
- **Harness selection must account for the image toolchain.** The base node24
  `@vercel/sandbox` image ships Python 3.9, but aider needs ≥3.10 — it only ran
  after a managed Python 3.11 was fetched via `uv`. Node-native harnesses
  (Claude Code) need no extra toolchain; python harnesses need `uv`/a newer
  Python bundled.
- Explicit non-goals stand: no persisting terminal scrollback into a Chat
  Session, no multi-tenant metering/quotas, no rendering path beyond ttyd +
  `xterm.js` (or an embedded `domain(port)` iframe), and no change to the Engine.
- A future multi-tenant mode is the one trigger that reopens the egress-injection
  and no-metering decisions above.

## Addendum (2026-05-31): transport, security, and co-view as built (slice #5)

Building the capstone tab (#200) on the real deployment target forced two of the
options above into their fallback positions. Recording them here so the gap
between the original decision and the shipped code is explicit, not silent.

- **Transport: the server WS proxy is infeasible on the deployment target, so we
  ship the named fallback — a room-membership-gated signed link + embedded
  iframe.** The app deploys to Vercel and must stay one-click-hostable there by
  any operator. Vercel serverless functions can't hold a persistent connection,
  and the App Router has no WebSocket-upgrade hook, so the app cannot sit in the
  middle of the terminal socket — the "proxy through the server, re-validate on
  connect" decision is simply not buildable without standing up a separate
  long-running service (which breaks "host it on Vercel"). We therefore took the
  fallback this ADR already sanctioned: `POST /api/terminal/url` gates on
  `room_member` (via `issueTerminalCredential` → `canAccess`), calls
  `ensureTerminal`, and returns the daemon's public `domain(port)` URL, which the
  client embeds in an iframe (`referrerpolicy="no-referrer"`). The #198 HMAC
  credential is still minted and bound (room+session+user, 60s TTL), ready for a
  real proxy to verify if one is ever built; today it gates *issuance* of the URL.

- **Resulting trust model: the daemon URL is a secret bearer link.** `domain(port)`
  is a public `*.vercel.run` URL and ttyd runs unauthenticated, so anyone holding
  the URL reaches the shell — membership gates *getting* the URL, not the URL
  itself. This is acceptable **only** under the self-hosted / single-trusted-
  operator boundary this ADR already fixes; the hardening is to keep the link
  from leaking (`no-referrer`, no logging) and rely on its unguessable random
  subdomain + the sandbox's ephemerality. A real proxy (or a daemon-side
  credential) is the path to closing this if the boundary ever changes — the
  same multi-tenant trigger that reopens egress injection reopens this.

- **Blast radius is bounded — the git token is *not* in the terminal shell.** The
  scary case ("a leaked terminal hands over the operator's GitHub identity") does
  not hold: `provision.ts` injects `SCREENPLAY_GH_TOKEN` per-`runCommand` for the
  Engine's git operations only; the ttyd daemon is launched with no token in its
  env, and the credential helper returns nothing when the var is unset. So a
  terminal user cannot `git push` as the operator. What a leaked terminal *does*
  expose, for one ephemeral sandbox's lifetime: model-API spend on the operator's
  keys (the accepted no-metering tradeoff — keys are injected at the firewall,
  usable but not readable), the checked-out repo source, any secrets in the
  repo's `envVars`, and general egress/compute. Residual escalation: a same-OS-
  user shell could read a concurrent Engine git command's token from
  `/proc/<pid>/environ` during the window it runs — narrow, requires active
  snooping, noted not fixed.

- **Co-view is deferred; terminal tabs are local-per-client, not shared.** The
  original surface stored the terminal tab in the shared `chatSessions` Y.Doc so
  collaborators could co-view one live PTY. Two problems surfaced: (1) ttyd forks
  a *new* shell per browser connection, so a shared tab did **not** yield a shared
  PTY — true co-view needs ttyd running a shared `tmux` session (and `tmux` in the
  image, which it isn't), and (2) a shared tab over unshared PTYs is incoherent UX.
  Rather than carry that, terminal tabs now live in **client-local state**, never
  entering the Y.Doc. This makes the non-persistence guarantee *structural*
  (terminals aren't in the conversation collection at all) and means a terminal
  appears only in the browser that opened it. Co-view (#200's "second client can
  co-view" criterion) is parked and may not be pursued; if revived, the shape is
  shared `tmux` session + creator-writable / watchers-read-only (`tmux attach -r`),
  whose main rough edge is cross-client terminal sizing.

## Addendum (2026-06-01): ttyd wire protocol validated — transport is direct-to-daemon (spike #255)

The PRD for xterm-rendered persistent terminal tabs (#253) reverses this ADR's
iframe rendering decision: render with our own `xterm.js` in React, connecting
**directly to the in-sandbox ttyd daemon's WebSocket** rather than embedding the
daemon's bundled web UI in an `<iframe>`. Before writing any production client,
#255 spiked the open transport question — *can a custom `xterm.js` client drive
the existing ttyd daemon directly over WebSocket, or does ttyd's framing/auth
model force us to stand up our own PTY/WebSocket server?*

**Decision: connect `xterm.js` straight to the ttyd daemon over its WebSocket.
No custom PTY/WS server is needed.** A throwaway harness
(`.context/ttyd-protocol-spike.mts`) booted a live `@vercel/sandbox`, installed
the same pinned ttyd `1.7.7` static binary prod uses, launched it `--writable`,
and connected a **raw** WebSocket client — no ttyd web UI, no xterm — driving the
protocol by hand. Every leg round-tripped on the first try:

- **Connect:** `wss://<domain(7681)>/ws`, WebSocket subprotocol `tty` (the server
  selects `tty` back); all frames are **binary**.
- **INPUT → OUTPUT** round-trip confirmed (sent a marker via `echo`, read it back
  in an OUTPUT frame).
- **RESIZE → real PTY resize** confirmed: after a RESIZE frame, `stty size` inside
  the shell reported the new `40 120` geometry — the resize reaches the PTY, not
  just xterm's local view.

This is unsurprising in hindsight — ttyd's *own* frontend is `xterm.js` speaking
this same protocol — but it is now proven against our exact binary and target
image, so the rendering slice is unblocked: swap the iframe for `xterm.js` +
`@xterm/addon-fit` and a small codec, no server-side transport to build.

The auth/trust model is **unchanged** from the 2026-05-31 addendum: ttyd runs
unauthenticated and the `*.vercel.run` `domain(port)` URL is a secret bearer
link, gated at *issuance* by `room_member`. Going browser-direct (vs. the
iframe, which was already browser-direct to the same URL) does not move this
boundary. A real WS proxy / daemon-side credential remains infeasible on Vercel
and remains the path to close the bearer-link gap if the single-trusted-operator
boundary ever changes (the same multi-tenant trigger as everything else here).

### ttyd 1.7.7 wire codec (pinned from observed bytes)

Enough to implement the client codec the PRD calls for. Each frame is
`[1 command byte][UTF-8 payload]`, binary.

- **Handshake — the first client message is JSON_DATA.** Before ttyd spawns the
  PTY it waits for one JSON message whose first byte is `{` (`0x7b`, which *is*
  ttyd's `JSON_DATA` command marker): `{"AuthToken":"<tok>","columns":C,"rows":R}`.
  `AuthToken` may be `""` when ttyd runs without `--credential` (our case). The
  spike confirmed the PTY only starts after this frame.
- **Client → server:**
  - `INPUT` = `'0'` (`0x30`): payload = raw keystroke bytes.
  - `RESIZE_TERMINAL` = `'1'` (`0x31`): payload = JSON `{"columns":C,"rows":R}`.
  - `PAUSE` = `'2'`, `RESUME` = `'3'`: flow control, optional.
- **Server → client:**
  - `OUTPUT` = `'0'` (`0x30`): raw PTY bytes (UTF-8 + xterm escape sequences) —
    feed directly to `term.write()`.
  - `SET_WINDOW_TITLE` = `'1'` (`0x31`): title string (observed: `bash -l (…)`).
  - `SET_PREFERENCES` = `'2'` (`0x32`): JSON of ttyd's client prefs (observed:
    `{ }`) — a custom client can ignore it.

### Carried risk surfaced: `tmux` is NOT in the base sandbox image

The spike's bonus probe found **no `tmux`** in the `@vercel/sandbox` node24 image
(`command -v tmux` → missing). This is the parent PRD's single carried
feasibility risk (the reattach UX depends on a working multiplexer). It does
**not** affect the transport decision above, but it means the reattach slice must
**bundle a static `tmux`** the same way `lib/sandbox/terminal.ts` bundles ttyd
(fetch a pinned static binary into `/tmp/screenplay`, launch ttyd with
`tmux new -A -s screenplay-<tabId>` as its command). Confirming a working static
`tmux` binary in this image is its own small spike before the reattach UX is
committed to — flagged here, not yet resolved.

The spike code is throwaway and lives only under `.context/` (gitignored); none
of it is on a production path.

## Addendum (2026-06-01): per-tab persistent `tmux` sessions — bundled binary + `--url-arg` transport (slice #259)

The reattach slice (#259) makes each terminal tab back onto its own persistent
`tmux` session so a running harness survives a page reload. Two decisions here
that the build rests on:

- **Bundle a pinned static `tmux`, mirroring the ttyd install — the base image
  ships none.** The 2026-06-01 spike addendum above flagged that
  `command -v tmux` is missing in the `@vercel/sandbox` base image (re-confirmed
  on the live image below, which reported `node v22.22.2` — the "node24" label
  in the earlier entries is stale, but `tmux` is a static binary so the runtime
  version is moot). So
  `lib/sandbox/terminal.ts` now provisions `tmux` the same way it provisions
  ttyd: an idempotent fetch into `/tmp/screenplay` (present binary
  short-circuits), guarded by `[ -x … ]`. We pin the official **`tmux/tmux-builds`
  musl-static `x86_64`** release (`v3.6b`,
  `tmux-<v>-linux-x86_64.tar.gz`) — the upstream-maintained static build rather
  than a third-party one. Unlike ttyd's raw-binary asset, this asset is a flat
  tarball, so the install step downloads, `tar -xzf`-extracts the single `tmux`
  member, `chmod +x`es it, and removes the archive.

  > **Live-image confirmation — done (2026-06-01).** This ADR's discipline (and
  > #259's first acceptance criterion) is to confirm a working static `tmux`
  > actually runs in *this* image (`new`/`attach`/`kill` succeed) before building
  > the UX on it. That confirmation isn't runnable from CI, so it was run against
  > a live `@vercel/sandbox` (the same way #255 ran its ttyd/transport spike):
  > the base image ships no system `tmux`; the exact `ensureTmuxInstalled` script
  > installs the pin and `tmux -V` reports `tmux 3.6b`; `tmux new -A -s` creates
  > a session and re-running it reattaches without spawning a duplicate;
  > `kill-session` removes it and is a clean no-op on an already-gone session.
  > All three operations succeed, so the pin is confirmed good for this image.

- **Per-tab session naming flows through ttyd's `--url-arg`, not a daemon per
  tab.** ttyd is one daemon on the one forwarded `TERMINAL_PORT`, so the per-tab
  variation can't come from a per-tab command. We launch ttyd `--writable
  --url-arg` with the base command `tmux new -A -s` (attach-or-create), and each
  client appends its session name as `?arg=screenplay-<tabId>`; ttyd forwards it
  as the final argv, yielding `tmux new -A -s screenplay-<tabId>` per
  connection. The name is derived from the tab's `terminalSessionId` via the
  pure `lib/terminal/session.ts:tmuxSessionName` so client (URL arg) and server
  (kill) agree. Consequences: a reload reattaches to the same session (running
  process intact, current output redrawn by `tmux attach`); two tabs on one
  Branch get isolated sessions instead of sharing a PTY; and closing a tab (X)
  now also runs `tmux kill-session -t screenplay-<tabId>` to terminate the
  shell + its process, not just drop the tab row.

  `--url-arg` lets a client pass arbitrary argv to the base command. This does
  **not** widen the trust boundary already fixed above: the daemon serves a
  `--writable` shell to anyone holding the bearer URL regardless, so the
  single-trusted-operator constraint is unchanged. Fresh-shell-on-rebuild and
  orphan-session cleanup are explicitly out of this slice (a follow-up), which
  assumes the sandbox is still alive across the reload.

## Addendum (2026-06-01): fresh-shell-on-rebuild + lazy orphan-tab pruning (slice #260)

The follow-up the #259 addendum named — the two "the world changed underneath
the tab" cases the reattach slice assumed away (a rebuilt sandbox, a deleted
Branch). Both fall out of mechanisms already in place; the slice is mostly
making them transparent and adding feedback, not new transport.

- **Fresh shell on a rebuilt sandbox is the `-A` flag doing its job — no new
  reconnect path.** A rebuilt VM boots from a filesystem snapshot but with no
  running processes, so the ttyd daemon (and its `tmux` sessions, which are
  processes, not files) are gone. `ensureTerminal` is already idempotent: the
  liveness probe reports stopped, so it re-fetches the bundled `ttyd`/`tmux`
  binaries and relaunches with `tmux new -A -s screenplay-<tabId>`. The `-A`
  attaches-or-creates, so a VM with no session transparently gets a fresh
  working shell rather than an error. The terminal does **not** initiate a
  rebuild itself (that needs repo + branch + git token — the agent reconnect
  flow's job); it assumes the rebuild already happened and just attaches.

- **Provisioning feedback is status-gated, which also suppresses a spurious
  error during boot.** `TerminalTab` now takes the Branch's sandbox `status`:
  while it's `creating`/`starting` the tab shows "Waiting for the sandbox to
  start…" and holds off connecting, so the operator sees clear provisioning
  feedback instead of a dead/blank pane or a transient 502 from
  `/api/terminal/url` racing a still-booting daemon. The connect effect re-runs
  when the status flips to `running`.

- **Orphan pruning is lazy and now deletes the row, not just the tab.** When a
  tab's Branch no longer exists, the canvas drops it from the tab strip **and**
  deletes its `terminalTab` row, so it can't resurrect on the next load. This is
  safe to do destructively because the canvas only renders post-Yjs-initial-sync
  (`liveblocks-client.tsx` gates render on `synced`), so an absent branch id is a
  genuinely deleted Branch, not an unhydrated collection. Pruning runs on
  load/connect off the branch + local-terminal state — no background job — and
  the delete is best-effort/idempotent (deleting an already-gone row is a no-op).
