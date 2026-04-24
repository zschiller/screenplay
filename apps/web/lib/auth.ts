import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"
import { oAuthProxy } from "better-auth/plugins"
import { db, schema } from "./db"

// Derived automatically so we don't need a per-env BETTER_AUTH_URL:
// - On Vercel, `VERCEL_URL` is the per-deployment host (unique per preview)
//   and `VERCEL_PROJECT_PRODUCTION_URL` is the stable production host.
// - Locally, fall back to http://localhost:3000.
// Override with BETTER_AUTH_URL only if you're hosting somewhere exotic.
const LOCAL_URL = "http://localhost:3000"

const baseURL =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : LOCAL_URL)

// Production URL is where the one GitHub OAuth callback is registered. All
// preview deployments route their OAuth flow through this URL via the
// oAuthProxy plugin — the proxy accepts the GitHub callback, then bounces a
// signed payload back to the originating preview so the session cookie is
// set on the preview's own origin.
const productionURL =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : LOCAL_URL)

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID ?? "",
      clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
      scope: ["repo", "user:email", "read:user"],
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["github"],
    },
  },
  // nextCookies() must be last — it wraps every response to forward Set-Cookie.
  plugins: [oAuthProxy({ productionURL }), nextCookies()],
})
