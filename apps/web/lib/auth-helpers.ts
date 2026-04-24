import "server-only"

import { headers } from "next/headers"
import { and, eq, inArray } from "drizzle-orm"
import { auth } from "@/lib/auth"
import { db, schema } from "@/lib/db"

/**
 * Return the authenticated user's ID, or null if no session.
 */
export async function getUserId(): Promise<string | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  return session?.user.id ?? null
}

export async function requireUserId(): Promise<string> {
  const userId = await getUserId()
  if (!userId) throw new Error("Unauthorized")
  return userId
}

/**
 * Full session (user + session row). Prefer this when callers need both.
 */
export async function getCurrentSession() {
  return auth.api.getSession({ headers: await headers() })
}

/**
 * Look up the GitHub OAuth access token for a user. Better Auth stores it on
 * the `account` row created when the user signed in with GitHub.
 */
export async function getGitHubTokenForUser(
  userId: string,
): Promise<string | null> {
  const rows = await db
    .select({ accessToken: schema.account.accessToken })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, "github"),
      ),
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
  email: string,
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
