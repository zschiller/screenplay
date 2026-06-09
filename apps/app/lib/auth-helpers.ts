import "server-only"

import { headers } from "next/headers"
import { and, eq, inArray } from "drizzle-orm"
import { auth, type Session } from "@/lib/auth"
import { db, schema } from "@/lib/db"
import { isLocalBuild } from "@/lib/local-mode"
import { LOCAL_USER } from "@/lib/local-user"

// The single seeded identity every request runs as in the local desktop build
// (PRD #404, issue #417). There is no OAuth and no `session` table, so the
// session is synthesized rather than read from Better Auth. Shaped to match the
// fields callers read off a real session (`user.id`/`name`/`email`/`image`).
const LOCAL_SESSION = {
  user: {
    id: LOCAL_USER.id,
    name: LOCAL_USER.name,
    email: LOCAL_USER.email,
    emailVerified: true,
    image: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
  session: {
    id: "local",
    userId: LOCAL_USER.id,
    token: "local",
    expiresAt: new Date(8640000000000000),
    createdAt: new Date(0),
    updatedAt: new Date(0),
  },
} as unknown as Session

/**
 * Return the authenticated user's ID, or null if no session. In the local
 * build it is always the single seeded local user.
 */
export async function getUserId(): Promise<string | null> {
  if (isLocalBuild) return LOCAL_USER.id
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user.id ?? null
}

export async function requireUserId(): Promise<string> {
  const userId = await getUserId()
  if (!userId) throw new Error("Unauthorized")
  return userId
}

/**
 * Full session (user + session row). Prefer this when callers need both. In the
 * local build the multi-user surface is excluded, so this resolves to the
 * synthesized single local session without consulting Better Auth.
 */
export async function getCurrentSession() {
  if (isLocalBuild) return LOCAL_SESSION
  return auth.api.getSession({ headers: await headers() })
}

/**
 * Look up the GitHub OAuth access token for a user. Better Auth stores it on
 * the `account` row created when the user signed in with GitHub.
 *
 * The local build has no `account` table — there is no login at all (#417) —
 * so the token resolves through the local resolver instead (PRD #428): the
 * host `gh` CLI's token when available, else a stored device-flow token, else
 * `null`. Git transport never needs this either way (`usesHostGitAuth`); the
 * token only feeds the GitHub *API* features (repo listing, Branch-via-API,
 * PRs, naming), which stay dark on `null` exactly as before.
 */
export async function getGitHubTokenForUser(
  userId: string
): Promise<string | null> {
  if (isLocalBuild) {
    // Dynamic import inside the compile-time-eliminated branch so the hosted
    // bundle never pulls the local chain (child_process + the keyring binding).
    const { resolveLocalGitHubToken } =
      await import("@/lib/github-local/token-resolver")
    return resolveLocalGitHubToken()
  }
  const rows = await db
    .select({ accessToken: schema.account.accessToken })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, "github")
      )
    )
    .limit(1)
  return rows[0]?.accessToken ?? null
}

/**
 * Convenience wrapper: resolve the current session and return its GitHub
 * token (or null if either is missing).
 */
export async function getGitHubToken(): Promise<string | null> {
  const userId = await getUserId()
  if (!userId) return null
  return getGitHubTokenForUser(userId)
}

export interface PublicUserInfo {
  id: string
  name: string
  email: string | null
  image: string | null
}

/**
 * Fetch user profile info for the given IDs. Used by Liveblocks presence and
 * collaborator listings.
 */
export async function getUsersByIds(ids: string[]): Promise<PublicUserInfo[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(inArray(schema.user.id, ids))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    image: r.image,
  }))
}

export async function getUserByEmail(
  email: string
): Promise<PublicUserInfo | null> {
  const rows = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(eq(schema.user.email, email.toLowerCase()))
    .limit(1)
  const row = rows[0]
  if (!row) return null
  return { id: row.id, name: row.name, email: row.email, image: row.image }
}
