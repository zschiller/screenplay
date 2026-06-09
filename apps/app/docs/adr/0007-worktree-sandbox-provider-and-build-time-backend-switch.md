# 7. Worktree Sandbox Provider + build-time backend switch

Date: 2026-06-09

Status: Accepted

## Context

ADR 0003 made the sandbox seam honest — a portable core plus an optional
Hibernation capability — but shipped only one backend (Vercel) and deliberately
declined an env-switched provider factory: _"The singleton stays… We do not pay
for provider selection before a second provider exists."_ It also named the one
event that would reopen that decision (and two deferred couplings): **a real
second provider** — "E2B, Modal, a local Docker driver."

The desktop build needs exactly that: a Sandbox backed by the host, not a remote
VM. This ADR records the arrival of the first real second provider — a **worktree
backend** — and the consequences ADR 0003 said it would unlock.

## Decision

- **Worktree Sandbox Provider.** A local `SandboxProvider` (`lib/sandbox/worktree.ts`)
  backs each Branch's Sandbox with a **git worktree on the host**. It implements
  only the portable core (`runCommand` with `cwd` = the worktree, `writeFiles` /
  `readFileToBuffer` against the host fs, `domain`, `delete`, plus the
  `worktreePath` / `homeDir` seams), so the agent's tool executor, logs route,
  and terminal plumbing need no changes. A managed root (`SCREENPLAY_WORKTREE_ROOT`)
  holds a **bare clone per source URL** (`repos/<hash>`) that every Branch's
  worktree (`trees/<name>`) is added from — worktrees of one repo share a single
  object store, which is the point of using them. A sidecar (`meta/<name>.json`)
  records the base repo and port map so `get` / `delete` need no re-derivation.

- **Non-hibernating, so the portable branches are the live ones.** Its instances
  do **not** implement `HibernatingSandbox`. Per ADR 0003 / 0005 that makes the
  reclone-fresh path active, **Sandbox Restart fail loud** (nothing to snapshot),
  and **Recreate map to remove + re-add** (`git worktree remove` then `add`).
  `create` rejects a snapshot source as a guard — the lifecycle layer never
  reaches it with one on a non-hibernating provider.

- **Durability is now provider-dependent, decoupled from Hibernation.** A worktree
  lives on host disk, so the Sandbox _is_ durable across process restarts (the
  checkout and its uncommitted edits survive) even though the backend can't
  hibernate. ADR 0003 framed "preserve uncommitted work" as the Hibernation
  bonus; the worktree backend shows durability and hibernation are independent —
  one is "the bytes survive on disk," the other is "freeze/thaw a VM."

- **Per-Branch dev-server port allocator.** `lib/sandbox/port-allocator.ts` hands
  out one distinct localhost port per key and reclaims it on release, so two
  local `npm run dev` previews don't both grab 3000. It uses spike #407's
  ephemeral-port technique (`bind 127.0.0.1:0`, read, drop) and, per that spike's
  TOCTOU note, treats an allocation as a hint, not a reservation: it re-rolls on a
  port already handed out and reclaims on delete. `domain(port)` returns the
  allocated `http://localhost:<port>`.

- **Build-time backend switch.** `sandboxProvider` is now selected at module load
  by `SANDBOX_BACKEND` (`"worktree"` for the desktop build; unset / `"vercel"`
  keeps the hosted build on Vercel, unchanged). This is the env-switched factory
  ADR 0003 deferred — now paid for, not speculative, because the triggering
  second provider has landed.

## Consequences

- ADR 0003's reclone-fresh fallback stops being dead code on this backend: it is
  the exercised path. The Recreate-is-remove-+-re-add and fail-loud-restart
  behaviors now run for real, not just in the Vercel-can't-snapshot edge.
- The two couplings ADR 0003 deferred until a second provider — egress network
  policy and terminal transport (both owned by ADR 0002) — are now genuinely in
  view. This slice does **not** resolve them: the worktree provider ignores the
  network policy (a single trusted local operator, no egress firewall to inject
  through) and leaves the terminal transport untouched. They remain ADR 0002's,
  to be reshaped by what this backend actually needs rather than guessed at here.
- Wiring the dev server to _bind_ its allocated port (so the localhost preview is
  reachable end-to-end, not just addressable) builds on this allocator and is the
  natural next slice; the seam (`domain` → allocated port) is in place for it.
