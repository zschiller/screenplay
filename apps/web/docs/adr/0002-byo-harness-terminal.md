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
