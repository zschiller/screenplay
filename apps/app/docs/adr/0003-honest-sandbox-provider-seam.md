# 3. Honest sandbox provider seam — portable core + optional Hibernation capability

Date: 2026-06-01

Status: Accepted

## Context

`lib/sandbox/` advertised a swappable provider seam — its own comment promised
that dropping in E2B, Modal, or a local Docker driver was "a one-line change."
That was not true. There was one implementation (Vercel) and the interface was
shaped end-to-end like Vercel Sandbox: a VM that auto-stops on a timeout and
reboots from its own filesystem snapshot, a `domain(port)` public URL, a
hardcoded `/vercel/sandbox` worktree and `/tmp`-vs-`$HOME` assumption, and a
`status` string the lifecycle layer compared against the literal `"running"`. A
reviewer (human or agent) reading the seam was misled about what a second
provider would cost, and the day one was attempted it would have broken on
assumptions the types never captured.

#264 made the seam tell the truth, scoped by comparing against
[mattpocock/sandcastle](https://github.com/mattpocock/sandcastle), which ships
five providers (docker, podman, vercel, daytona, no-sandbox) and has therefore
actually generalized across real backends. We adopt the seams it validated and
deliberately decline the machinery it needs only because it has five providers.
A second provider is real but distant, so the goal was honesty at the lowest
speculative cost — not a working second backend.

The split reshapes the central interface every `lib/sandbox/*` workflow is
written against, and it bakes in a non-obvious call (a type guard rather than
optional methods, with rejected alternatives), so it is recorded here rather
than left implicit in the types. CONTEXT.md gains the **Sandbox** and **Sandbox
Provider** glossary entries; this ADR owns the *why* of the structural split and
the couplings it deliberately leaves deferred.

## Decision

- **Core vs capability split.** `SandboxInstance` (the portable core) holds only
  what every conceivable backend can honor: `name`, `domain(port)`, `runCommand`,
  `writeFiles`, `readFileToBuffer`, `delete`, plus the provider-supplied path
  seams `worktreePath` and `homeDir`. A `HibernatingSandbox` sub-interface
  extends the core with the operations only a backend that can freeze and thaw a
  VM can honor: `snapshot()`, `extendTimeout()` (the keep-alive heartbeat),
  `isRunning()`, and the resume affordance (booting a stopped VM via
  `SandboxProvider.get({ resume: true })`). `SandboxProvider` keeps `create` /
  `get`.

- **The capability is a type guard, not optional methods or a bag.**
  `supportsHibernation(s): s is HibernatingSandbox` is the decision. Hibernation
  methods are unreachable without narrowing through it, so the `else` branch is
  always the portable "reclone fresh" path and cannot be silently forgotten.
  - *Rejected: optional methods on the core* (`snapshot?()`) — `if (s.snapshot)`
    is forgettable and a half-implementing provider type-checks fine, defeating
    the point.
  - *Rejected: a `capabilities` bag* — over-structured for a single capability
    today.

- **Liveness is a portable predicate, not a string compare.**
  `isSandboxRunning(s)` replaces every `status === "running"` check (which
  assumed a Vercel-shaped `status` field on every instance). A hibernating
  sandbox is authoritative via its own `isRunning()`; a portable instance has no
  stopped-but-present state, so it is live for as long as its handle exists.

- **Path seams from sandcastle (validated, not speculative).** `worktreePath`
  and `homeDir` are exposed on the core and threaded through the workflow layer,
  retiring the `/vercel/sandbox` literal and the implicit `/tmp`-vs-`$HOME`
  assumption. `installClaudeCode` derives its pre-seeded `.claude.json` project
  key from `worktreePath`, so onboarding follows the actual checkout location on
  any provider.

- **`reprovisionFromGit` deep module.** The reclone-fresh path (clone source →
  setup script → git config → dev launch) is extracted into one testable unit,
  called by both the hibernation-fallback branch and the lifecycle entry points.

- **Lifecycle branching.** `restartSandbox`, `reconnectSandbox`, and
  `keepAliveSandbox` each branch on `supportsHibernation`: Vercel takes the
  existing snapshot / resume / extend path unchanged; the `else` is
  `reprovisionFromGit` (or, for keep-alive, a clean no-op).

- **The singleton stays.** No env-switched provider factory — `sandboxProvider`
  stays a singleton. We do not pay for provider selection before a second
  provider exists.

## Consequences

- A provider author sees a small portable core and one clearly-optional
  capability, and the compiler hands them a checked choice: implement Hibernation
  completely, or accept the reclone fallback. A half-implementation no longer
  type-checks.
- On Vercel the reclone-fresh branch is **dead code today** — but it is the
  exercised, honest path the moment a non-hibernating provider lands, which is
  the whole point of building it now rather than discovering its absence then.
- Uncommitted-change preservation across a restart is now explicitly a *bonus*
  (Hibernation), not a contract: a non-hibernating provider reclones fresh and
  loses un-pushed edits, a known and accepted degradation.

### Deferred couplings (known debt)

#264 deliberately declined to abstract two couplings, because we have only one
provider's worth of evidence and would guess the abstraction wrong. They are
recorded here as known debt so a future reviewer does not mistake them for
oversights or "fix" what was intentional.

- **Egress network policy / firewall header-injection** — left as-is, *not*
  generalized. sandcastle models no network policy at all, and **ADR-0002**
  already owns this coupling, its Vercel-firewall-overwrite semantics, and the
  self-hosted / single-trusted-operator boundary that constrains it. Generalizing
  it here would invent an abstraction against a single backend.

- **Terminal transport** — the ttyd persistent-`tmux` / WebSocket model
  (**ADR-0002**) is unchanged; only the binary fetch was made architecture-aware
  so it is no longer silently x86_64/Vercel-image-specific. Migrating to a
  request-scoped `interactiveExec` model is explicitly out of scope.

- **Named trigger for both: a real second provider** (E2B, Modal, a local Docker
  driver). That is the one event that reopens these two decisions — at which
  point a second backend reveals the real shape of the network-policy and
  terminal-transport abstractions, and the reclone-fresh fallback stops being
  dead code. Until then, deferring is the honest call, and ADR-0002 remains the
  owner of both couplings.
