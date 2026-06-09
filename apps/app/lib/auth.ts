import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"
import { oAuthProxy } from "better-auth/plugins"
import { db } from "@/lib/db"
import { getBaseURL, getProductionURL, getTrustedOrigins } from "@/lib/base-url"
import { AUTH_BASE_PATH } from "@/lib/base-path"

function createAuth() {
  return betterAuth({
    baseURL: getBaseURL(),
    // The product is served under Next's `/app` basePath, so the auth handler
    // actually lives at `/app/api/auth`. Better Auth treats `basePath` as the
    // full prefix before each endpoint and derives every URL from it — the OAuth
    // `redirect_uri` (`/app/api/auth/callback/github`), the `oAuthProxy` callback,
    // and the client's fetch target all pick this up. `baseURL` stays the bare
    // origin so `trustedOrigins` matching (Origin header, no path) keeps working.
    basePath: AUTH_BASE_PATH,
    trustedOrigins: getTrustedOrigins(),
    database: drizzleAdapter(db, { provider: "pg" }),
    // GitHub-only. `repo` is needed so we can clone private repos and push
    // commits on the user's behalf; the other scopes give us identity info.
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
        scope: ["repo", "read:user", "user:email"],
      },
    },
    plugins: [
      // Lets Vercel preview deploys share one GitHub OAuth app: the OAuth
      // callback is pinned to the production URL, and the proxy bounces the
      // user back to whatever preview URL they started on.
      oAuthProxy({
        productionURL: getProductionURL(),
        currentURL: getBaseURL(),
      }),
      // Must be last — flushes Set-Cookie headers from server actions.
      nextCookies(),
    ],
  })
}

// Lazily constructed so merely importing this module is side-effect-free. The
// local desktop build (PRD #404, issue #417) excludes GitHub OAuth and runs
// without `BETTER_AUTH_PRODUCTION_URL`/`GITHUB_CLIENT_*`, which `createAuth()`
// reads eagerly (and `getProductionURL()` throws on). Deferring construction to
// first property access means auth-helpers and the `/api/auth` route can import
// `auth` in the local build without ever building it — they short-circuit on
// `isLocalBuild` before any access. The hosted build builds it on first use.
let instance: ReturnType<typeof createAuth> | null = null

function getAuth(): ReturnType<typeof createAuth> {
  if (!instance) instance = createAuth()
  return instance
}

export const auth = new Proxy({} as ReturnType<typeof createAuth>, {
  get(_target, prop) {
    const real = getAuth() as unknown as Record<string | symbol, unknown>
    const value = real[prop]
    return typeof value === "function" ? value.bind(real) : value
  },
})

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"]
