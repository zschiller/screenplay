import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"
import { oAuthProxy } from "better-auth/plugins"
import { db } from "@/lib/db"
import { getBaseURL, getProductionURL, getTrustedOrigins } from "@/lib/base-url"
import { AUTH_BASE_PATH } from "@/lib/base-path"

export const auth = betterAuth({
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

export type Session = typeof auth.$Infer.Session
