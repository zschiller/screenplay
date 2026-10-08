import "server-only"

import type { GitHubAccess, GitIdentity } from "./types"
import { GITHUB_DOT_COM_URLS } from "./urls"

export const OAUTH_ACCOUNT_ID = "oauth-account"

/**
 * The `oauth-account` built-in: Hosted. Each person's token is the one Better
 * Auth stored on their `account` row when they signed in with GitHub, and git
 * is brokered: their token per command and their `user` row as author, so
 * every push and commit in a shared sandbox is attributed to whoever drove it.
 */
export function createOAuthAccountAccess(): GitHubAccess {
  return {
    id: OAUTH_ACCOUNT_ID,
    ...GITHUB_DOT_COM_URLS,
    apiToken: accountToken,
    git: { kind: "brokered", token: accountToken, identity: userIdentity },
  }
}

// The db loads on first use, so modules that only read `apiUrl` (and their
// tests) don't open a database.
async function accountToken(userId: string): Promise<string | null> {
  const { db, schema } = await import("@/lib/db")
  const { and, eq } = await import("drizzle-orm")
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
 * The person's real name and email from their `user` row. `user.email` is NOT
 * NULL, so a found user always yields an identity; `null` only when there's no
 * such user, and the caller then stamps none rather than inventing one.
 */
async function userIdentity(userId: string): Promise<GitIdentity | null> {
  const { db, schema } = await import("@/lib/db")
  const { eq } = await import("drizzle-orm")
  const rows = await db
    .select({ name: schema.user.name, email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1)
  const row = rows[0]
  return row ? { name: row.name, email: row.email } : null
}
