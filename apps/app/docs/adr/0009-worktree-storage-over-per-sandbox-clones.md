# 9. Desktop sandbox storage: worktrees over per-Sandbox clones

Date: 2026-06-10

Status: Accepted

## Context

PR #433 replaced the desktop backend's worktree-per-Branch storage (ADR 0007)
with an independent clone per Sandbox, hardlinked against a per-source mirror,
and — citing that the one-checkout-per-ref limit "was never a domain rule" —
deleted the one-Branch-per-ref behavior everywhere, including the hosted
build's UI guard. Neither change was weighed in an ADR. The stated motivation
(representing N Sandboxes per ref) was not a requirement; the same PR's
genuinely needed work — the `$SCREENPLAY_PORT` dev-script contract and the
port allocation/binding fixes — is orthogonal to the storage model.

The history also conflated two different statements:

- **one-Sandbox-per-ref as infrastructure**: git refuses to check the same
  branch out into two worktrees of one repo. Real, but only where worktrees
  are the storage.
- **one-Branch-per-ref as domain rule**: glossary commit #431 promoted the
  limit to "enforced on any backend". That projected the desktop constraint
  onto the hosted backend, which never had it.

The actual position is per-backend: the hosted backend doesn't limit Branches
per ref; the desktop backend's storage does, and the limit should be surfaced
there because it must be — not adopted as domain language, and not paid for
on the hosted backend.

## Decision

- **Worktrees are the desktop storage model.** Each Branch's Sandbox is a git
  worktree off one shared local clone per source
  (`lib/sandbox/local/worktree.ts`, `lib/sandbox/local/provider.ts`). One
  object store serves every Branch permanently: a fetch lands once, and disk
  stays flat as the repo grows. The clone-per-Sandbox design's hardlink
  sharing decays — after creation every clone fetches independently,
  duplicating new objects per open Branch — and its mirror, naming scheme,
  and migration machinery are complexity purchased for the N-per-ref
  property nobody asked for. (Sandboxes the short-lived clone generation left
  on disk still resolve and delete through their recorded metas.)

- **One-Branch-per-ref is a backend property, surfaced loud on desktop.** On
  the local backend, opening a ref that another workspace holds fails with
  `RefAlreadyOpenError`; provisioning never force-removes or shares another
  Sandbox's checkout. The desktop UI also blocks renames onto a ref another
  open Branch holds (`isLocalBuild`-gated). The hosted backend keeps no limit
  in either place: concurrent Sandboxes on one ref coordinate through normal
  git push/pull semantics.

- **The user's own checkout is never a Sandbox.** A `local-path` Repo whose
  clone has the requested branch checked out fails with
  `BranchCheckedOutInCloneError` instead of aliasing the user's working tree
  (the pre-#433 behavior silently handed the agent the user's live checkout,
  uncommitted edits and all). A `clone-url` Repo's managed clone is kept on a
  detached HEAD so the case cannot arise there.

- **#433's port contract stands unchanged.** The `hostPort` seam,
  `$SCREENPLAY_PORT`/`$PORT` threading, proxy/ttyd resolved-port binding, and
  `DevServerPortIgnoredError` are storage-agnostic and remain. So does the
  `SANDBOX_BACKEND=local` canonical name ("worktree" stays accepted): the
  backend's identity is locality, the worktree is the mechanism.

## Consequences

- ADR 0007's storage design is reaffirmed; the #431/#433 glossary language
  claiming the per-ref limit was a universal domain rule (and then that it
  never existed anywhere) is both superseded by the per-backend phrasing in
  `CONTEXT.md`.
- Opening one branch in two desktop workspaces is not representable, by
  design. If that ever becomes a real requirement, the storage trade must be
  re-weighed here — switching to independent clones is the known alternative,
  and its costs (object duplication per fetch, mirror upkeep, app-level limit
  enforcement where worktrees gave it free) are recorded above.
- Two Projects targeting different apps of one monorepo share the per-source
  manager, so the per-ref limit spans them on desktop: the second Project
  opening an already-open ref gets the same named error.
