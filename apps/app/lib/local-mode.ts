/**
 * The single build-time switch that strips the **multi-user surface** from the
 * local desktop distribution (PRD #404, issue #417).
 *
 * The hosted app is multi-tenant: GitHub OAuth login, `roomMember` sharing,
 * Yjs awareness/presence, and `thread`/`comment` co-view. The desktop app runs
 * for one person on their own machine, so that entire surface is excluded — no
 * login screen, no membership/sharing/comments, and `canAccess`/`room_member`
 * collapse to a single seeded local user (`@/lib/local-user`).
 *
 * Set `NEXT_PUBLIC_SCREENPLAY_LOCAL=1` for the desktop build. It is a
 * `NEXT_PUBLIC_` flag so the same constant is inlined into both the server
 * runtime (auth/session resolution, access checks) and the client bundle (the
 * UI affordances — share, comments, sign-out — that simply don't render). Being
 * a compile-time constant also lets the bundler dead-code-eliminate the gated
 * branch, so the hosted build carries no desktop code and vice versa.
 *
 * This is a sibling of the per-seam backend switches the local build already
 * sets — `SANDBOX_BACKEND=worktree`, `SCREENPLAY_DB=pglite`,
 * `NEXT_PUBLIC_YJS_HOST=local` — but it gates an app-level *capability* (the
 * access model), not a swappable backend, so it gets its own flag.
 */
export const isLocalBuild = process.env.NEXT_PUBLIC_SCREENPLAY_LOCAL === "1"
