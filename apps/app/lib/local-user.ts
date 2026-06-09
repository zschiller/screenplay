/**
 * The single seeded user the local desktop distribution runs as. The hosted
 * app authenticates many users through GitHub OAuth; the local app (PRD #404)
 * removes the multi-user layer entirely and collapses `canAccess`/`room_member`
 * down to this one identity. Yjs-host token issuance binds to it in local mode
 * (see `app/api/yjs/auth/route.ts`).
 *
 * Kept in its own dependency-free module so both the API route and the local
 * Yjs host can import it without pulling in server-only transport code.
 */
export const LOCAL_USER_ID = "local"

export const LOCAL_USER = {
  id: LOCAL_USER_ID,
  name: "Local User",
  // A placeholder address only so the not-null `user.email` column has a value
  // when the single local user is seeded on boot — the local build never sends
  // mail or matches on it (there is no sharing-by-email).
  email: "local@localhost",
} as const
