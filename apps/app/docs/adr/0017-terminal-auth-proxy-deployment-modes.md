# 17. Terminal Auth Proxy — one verified core, two deployment modes

Date: 2026-07-07

Status: Accepted — planned in PRD #694. Builds on ADR 0002 (BYO-harness terminal)
and its 2026-07-07 addendum, which introduced the env-selected
`TerminalAccessStrategy` seam and named the `proxy` strategy's hosting as the open
question this ADR closes.

## Context

ADR 0002's 2026-07-07 addendum made the terminal's transport auth a pluggable
strategy (`bearer` / `ttyd-credential` / `proxy`). The first two are entirely
app-side and need no extra service. The third — `proxy`, the only posture with
continuous **per-user** authorization and the daemon kept off the open internet —
needs a component that can hold a WebSocket and re-check membership on connect.

That addendum left the proxy's *hosting* as "Cloudflare Durable Objects or Fly,
or in-process if you're off Vercel." That answer fails the operator this work
exists for: the one **self-hosting on Vercel**. Vercel has no persistent
WebSocket upgrade, so in-process is impossible there, and "stand up a Durable
Object yourself" is an exercise, not a supported path. The strong posture was
therefore effectively unavailable to Vercel self-hosters, whose only real
hardening was `ttyd-credential`.

This is self-hosted security only. Multi-tenant concerns — metering, quotas,
per-tenant or BYO keys, billing — are **not** in scope here or anywhere in this
line of work; the shared-operator-key egress model of ADR 0002 is unchanged.

## Decision

- **Ship one Terminal Auth Proxy with a single verified core and two deployment
  modes, selected by configuration.** The core is transport- and
  platform-agnostic: a pure `authorizeConnection(token, binding,
  lookupMembership)` composed from the existing `verifyTerminalCredential`, plus a
  socket bridge (the shape already written in `lib/terminal/local/server.ts`). The
  two modes are thin adapters over that one core:
  - **Embedded** — for a self-host running a long-running Node server (Docker, a
    VPS, a custom server): the proxy runs in-process, on the same singleton
    lifecycle the desktop local terminal server already uses. No extra deploy.
  - **Standalone companion** — for a self-host **on Vercel** (or anyone wanting
    separation): the same core runs as a small service deployed once beside the
    Vercel app. Two ready-to-deploy targets are produced from one source — a
    container image (Fly / Render / Railway / any box) and a Cloudflare Worker +
    Durable Object build — so deploying the companion is documented and near
    one-command.

  Which mode runs is a deployment choice (`TERMINAL_PROXY_URL` unset → embedded;
  set → the app hands clients that URL), never a code fork. Both modes are the
  identical admit/reject logic, so the security guarantee does not depend on which
  a given operator picked.

- **The recommended strong posture on Vercel composes `proxy` with
  `ttyd-credential`.** A Vercel Sandbox exposes its daemon port as a *public*
  `domain(port)` route, and an external companion may have no private route to it.
  So under `proxy` the daemon is launched with a `--credential` secret known only
  to the proxy: the port stays publicly routable but is useless without the
  proxy-held secret, and the proxy layers per-user, revocable, connect-time
  authorization on top. `ttyd-credential` is therefore not a lesser sibling of
  `proxy` here — it is the piece that makes the proxy's guarantee hold on a
  platform with a public Sandbox port.

- **Authority stays in the app; the proxy stays a thin, stateless bridge.** The
  proxy holds no database and no long-lived secret beyond the shared
  `TERMINAL_AUTH_SECRET` it already needs to verify the HMAC. It re-checks
  membership through one **authenticated internal endpoint** exposing `canAccess`
  (the embedded proxy calls `canAccess` in-process and skips the hop). The
  endpoint is signed with the shared secret so it is not an open `canAccess`
  oracle.

- **Carried feasibility question — spike before building the companion bridge.**
  Whether an external companion can reach a Vercel Sandbox's daemon over a private
  route, or only via public `domain(port)`. If only public, the `ttyd-credential`
  composition above is load-bearing rather than optional for the companion mode,
  and "off the public internet" becomes "reachable but useless without the
  proxy-held secret." Resolve this on a live Sandbox the way ADR 0002's #255 /
  #259 spikes did before committing the companion transport.

## Consequences

- The `proxy` strategy from ADR 0002's addendum finally has a supported home for
  every self-hoster: embedded for a long-running box, standalone companion for
  Vercel. No operator is left without a path to real terminal auth.
- `verifyTerminalCredential` — minted and bound since ADR 0002 (2026-05-31) but
  never called outside its test — becomes load-bearing: it is the heart of
  `authorizeConnection`.
- The only new app surface beyond the ADR 0002 addendum is the authenticated
  membership-recheck endpoint and the daemon `--credential` under proxy mode. No
  schema, Y.Doc, or domain changes; turning the proxy on is config-and-deploy.
- Adding a future target (a platform-native WebSocket path, if Vercel ever ships
  one) is a new adapter over the same core, not a rewrite — the same "one core,
  thin adapters" property that lets embedded and companion share their guarantee.
- Multi-tenant remains explicitly out of scope: this ADR hardens single-operator /
  trusted-team self-hosting and does not reopen ADR 0002's egress-injection or
  no-metering decisions.
