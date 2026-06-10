/**
 * The `SANDBOX_BACKEND` build-time switch, read in one place. The desktop
 * provider is the **local** backend in domain language — "worktree" was the
 * mechanism (and per-Branch clones have since replaced it), not the identity —
 * so `"local"` is the canonical value. `"worktree"` keeps selecting the same
 * backend for compatibility: the shipped desktop shell and existing
 * `desktop.env` profiles set it, and a rename must not strand them.
 *
 * Deliberately free of `server-only` and of any provider import so the light
 * consumers — `instrumentation.ts`, route handlers, `lib/sandbox/terminal.ts` —
 * can branch on the backend without dragging a provider graph in.
 */
export function isLocalSandboxBackend(): boolean {
  const backend = process.env.SANDBOX_BACKEND
  return backend === "local" || backend === "worktree"
}
