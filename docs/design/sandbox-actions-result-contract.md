# Design note — Sandbox actions: one result contract + split

Status: **proposed** (not yet implemented). Captured from an architecture
review + design grilling session. Pick up from here.

See `CONTEXT.md` for domain terms. Relevant code: `lib/sandbox/types.ts` (the
provider seam), `lib/sandbox-actions.ts` (the 844-line actions layer).

> The original review flagged this as "callers reach around the swappable
> provider seam." Grilling corrected that: **the seam is clean** — only
> `lib/sandbox/vercel.ts` imports the raw `@vercel/sandbox` SDK; everything else
> is written against the `SandboxProvider` / `SandboxInstance` interface, and the
> one direct `sandboxProvider.get` outside the actions (`tool-executor.ts`) is
> *using* the seam, not bypassing it. The real problem is one layer up, in the
> **actions**.

---

## Problem

There are two layers, and only the upper one is troubled:

- **`SandboxProvider` / `SandboxInstance`** (`lib/sandbox/types.ts`) — the
  swappable VM seam (create / get / runCommand / snapshot / delete). Clean,
  provider-agnostic, honored. **Leave it alone.**
- **`lib/sandbox-actions.ts`** — ~20 `"use server"` workflow actions built on the
  seam (clone, install deps/CLI/bridge, dev-server, restart, reconnect,
  keep-alive, branch create/rename, git config, diff, route crawl, logs, …).
  This 844-line grab-bag is the problem.

Two concrete issues:

1. **No uniform result — at least four shapes for "did it work?":**
   - discriminated `{ success: true; … } | { success: false; error }` (clone,
     logs, crawlRoutes)
   - flat `{ success: boolean; error? }` (installs, branch ops, git config,
     keep-alive)
   - `SandboxResult` = `{ sandboxName; previewDomain; status: "running" | "error";
     error? }` — *always returns, check `status`* (dev-server, restart, reconnect)
   - primitives / nullable (`boolean`, `string`, `T | null`, `void`)

   Failure is even *detected* two ways: some `throw` via a `runLogged` helper;
   others check `result.exitCode !== 0` by hand. Callers consume `.error` /
   `.success` to show the user (`canvas.tsx:3516`, `4574`; the sidebar renders
   `agent.error`), so the error string must cross the server-action boundary as a
   **return value** — Next redacts thrown errors in production, so "just throw"
   isn't an option for these.

2. **~15× repetition + a leak.** Every action hand-rolls "resolve the instance →
   run a command → map exit code / catch → shape a result." And the failure path
   returns raw `stderr.slice(0, 500)` **unredacted**, so a failing git command can
   spill the sandbox's baked-in GitHub token into the chat UI — the exact threat
   `lib/agent/redact.ts` guards against (same gap as the agent-tools note).

## Decisions settled in the grilling session

1. **The provider seam stays as-is.** No changes to `SandboxProvider` /
   `SandboxInstance`. (It's also what makes the actions testable — see Tests.)

2. **One result shape for the command actions only.** The ~12 actions that *do*
   something and can fail adopt:

   ```ts
   type SandboxActionResult<T = void> =
     | { success: true; value: T }
     | { success: false; error: string }
   ```

   The discriminant stays `success` (callers already branch on it). The rich
   `SandboxResult` collapses into this: dev-server / restart / reconnect return
   `SandboxActionResult<{ sandboxName; previewDomain }>`, and the redundant
   `status: "running" | "error"` double-encoding disappears (success ⟺ running).
   The pure **query** actions (`getGitHubToken`, `getDiffStats`,
   `getBridgeVersion`, `getSandboxCliContext`) keep returning their plain value /
   `null` — wrapping a lookup in a result is ceremony.

3. **One command-runner concentrates the repetition.** Two helpers in a shared
   internal module (e.g. `lib/sandbox/run.ts`), *not* on the provider (it stays
   thin):

   ```ts
   // resolves the instance, runs the body, converts any throw into a
   // { success: false } with a redacted message
   runSandboxAction<T>(name, fn: (s: SandboxInstance) => Promise<T>): Promise<SandboxActionResult<T>>

   // runs a command; throws SandboxStepError (carrying redacted + truncated
   // stderr) on a non-zero exit
   step(sandbox, cmd, args?): Promise<string /* stdout */>
   ```

   Each action becomes a linear script: `runSandboxAction(name, async (s) => { await step(s, …); await step(s, …); return value })`. No per-step error handling, no per-action try/catch. (`runLogged` already throws — this generalizes it.)

4. **Redaction on the failure path.** `runSandboxAction` / `step` run
   `redactSensitiveInfo` over the error/stderr before it leaves, closing the
   token leak structurally.

5. **"Best-effort" stays a caller policy.** Actions like `installClaudeCode`
   (documented "never fail the pipeline") report failure *truthfully* via the
   result; the caller (`agent/create` route) chooses to ignore certain failures.
   The action no longer swallows its own errors.

6. **Split the file by responsibility** (each keeps `"use server"`):
   - `lib/sandbox/provision.ts` — clone, install deps / CLI / bridge, bridge
     version, dev-server
   - `lib/sandbox/lifecycle.ts` — restart, reconnect, keep-alive, remove, probe
   - `lib/sandbox/git.ts` — branch create / rename, git config, diff stats
   - `lib/sandbox/inspect.ts` — logs, route crawl
   - `lib/sandbox/run.ts` — the result type + `runSandboxAction` + `step`

   And **pull the non-sandbox helpers out entirely**: `getGitHubToken`,
   `resolveActingUserId`, `getSandboxCliContext` are auth / CLI-context concerns
   that don't belong in a sandbox-lifecycle module — move them to
   `auth-helpers` / a small context module.

   _Open sub-choice:_ `crawlRoutes` and `getDiffStats` sit on a line (inspection
   vs git/provision); placed above by primary concern, easy to move.

## Tests

The clean provider seam is the gift here: actions become testable by passing a
**fake `SandboxProvider`** (scripted `runCommand` exit codes / stderr) — no real
VM, no Vercel.

- a command action returns `{ success: true, value }` on exit 0 and
  `{ success: false, error }` on non-zero;
- `step` maps a non-zero exit to a thrown `SandboxStepError`;
- a failure whose stderr contains a GitHub token comes back `[REDACTED]`;
- query actions still return their plain value / `null`.

## Migration (incremental; each step independently reviewable)

1. Add `lib/sandbox/run.ts` (result type + `runSandboxAction` + `step`).
2. Convert command actions one responsibility-group at a time to the new
   contract, moving each group into its file as it's converted; update that
   group's callers (`canvas.tsx`, `agent-sidebar.tsx`, the create route, …).
3. Pull the auth/context helpers out to `auth-helpers`.
4. Delete the now-unused `SandboxResult` and the bespoke `{ success: boolean }`
   shapes.

## Notes / shared with other candidates

- The unredacted-`stderr` leak is the same class of bug as the agent-tools note
  (#2). Both want `redactSensitiveInfo` applied at the one boundary where output
  leaves a trusted layer.
