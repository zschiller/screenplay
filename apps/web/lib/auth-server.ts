import "server-only"

import { headers } from "next/headers"
import { and, eq, inArray, sql } from "drizzle-orm"
import { auth } from "./auth"
import { db, schema } from "./db"

export type SessionUser = {
  id: string
  name: string
  email: string
  image: string | null
}

/**
 * Returns the current session + user for the incoming request, or null.
 * Replaces Clerk's `auth()` / `currentUser()`.
 */
export async function getSession() {
  return auth.api.getSession({ headers: await headers() })
}

/**
 * Returns just the user id, or null. Clerk's `auth()` returned `{ userId }`;
 * this is the Better Auth equivalent.
 */
export async function getUserId(): Promise<string | null> {
  const session = await getSession()
  return session?.user?.id ?? null
}

export async function requireUserId(): Promise<string> {
  const id = await getUserId()
  if (!id) throw new Error("Unauthorized")
  return id
}

export type DbUserRow = {
  id: string
  name: string | null
  email: string
  image: string | null
}

export async function getUsersByIds(ids: string[]): Promise<DbUserRow[]> {
  if (!ids.length) return []
  return db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(inArray(schema.user.id, ids))
}

export async function getUserByEmail(
  email: string,
): Promise<DbUserRow | null> {
  const [row] = await db
    .select({
      id: schema.user.id,
      name: schema.user.name,
      email: schema.user.email,
      image: schema.user.image,
    })
    .from(schema.user)
    .where(sql`lower(${schema.user.email}) = lower(${email})`)
    .limit(1)
  return row ?? null
}

/**
 * Look up the acting user's GitHub OAuth access token. Better Auth stores
 * provider tokens on the `account` row created during social sign-in.
 * Returns null if the user has not connected GitHub (or the token has been
 * cleared).
 */
export async function getGitHubAccessToken(
  userId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ accessToken: schema.account.accessToken })
    .from(schema.account)
    .where(
      and(
        eq(schema.account.userId, userId),
        eq(schema.account.providerId, "github"),
      ),
    )
    .limit(1)
  return row?.accessToken ?? null
}

/**
 * Human-readable label for a user (first+last, or email, or "Anonymous").
 * Mirrors the fallback chain that used to read Clerk's firstName/lastName/username.
 */
export function displayName(user: {
  name?: string | null
  email?: string | null
}): string {
  return user.name?.trim() || user.email || "Anonymous"
}
