import "server-only"

import { headers } from "next/headers"
import { auth } from "./auth"
import { ensureSchema, query } from "./db"

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
  await ensureSchema()
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
  const { rows } = await query<DbUserRow>(
    `SELECT id, name, email, image FROM "user" WHERE id = ANY($1::text[])`,
    [ids],
  )
  return rows
}

export async function getUserByEmail(
  email: string,
): Promise<DbUserRow | null> {
  const { rows } = await query<DbUserRow>(
    `SELECT id, name, email, image FROM "user" WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  )
  return rows[0] ?? null
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
  const { rows } = await query<{ access_token: string | null }>(
    `SELECT "accessToken" AS access_token
       FROM "account"
      WHERE "userId" = $1 AND "providerId" = 'github'
      LIMIT 1`,
    [userId],
  )
  return rows[0]?.access_token ?? null
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
