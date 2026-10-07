import "server-only"

import { and, eq } from "drizzle-orm"
import { db, schema } from "@/lib/db"
import { isLocalBuild } from "@/lib/local-mode"
import {
  createBrokeredGitHubAccess,
  createHostGitHubAccess,
  type GitHubAccess,
} from "@/lib/github-access/adapters"

export type { GitHubAccess, GitIdentity } from "@/lib/github-access/adapters"

/**
 * The GitHub access adapter, picked once at startup: **host** on the desktop
 * build, **brokered** on hosted. See {@link GitHubAccess}.
 *
 * The desktop build has no `account` table and no login (#417), so its token
 * comes from the local resolver: the `gh` CLI's token, else null (PRD #428,
 * ADR 0018). The dynamic import sits inside the compile-time-eliminated
 * branch so the hosted bundle never pulls the local chain (child_process).
 */
export const githubAccess: GitHubAccess = isLocalBuild
  ? createHostGitHubAccess({
      token: async () => {
        const { resolveLocalGitHubToken } =
          await import("@/lib/github-local/token-resolver")
        return resolveLocalGitHubToken()
      },
    })
  : createBrokeredGitHubAccess({
      // Better Auth stores the OAuth token on the `account` row created when
      // the person signed in with GitHub.
      async token(userId) {
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
      },
      // `user.email` is NOT NULL, so a found user always yields an identity.
      async identity(userId) {
        const rows = await db
          .select({ name: schema.user.name, email: schema.user.email })
          .from(schema.user)
          .where(eq(schema.user.id, userId))
          .limit(1)
        const row = rows[0]
        return row ? { name: row.name, email: row.email } : null
      },
    })
