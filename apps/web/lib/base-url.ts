/**
 * Base URL for the current deployment. Drives Better Auth's `baseURL` and any
 * other code that needs to build an absolute URL back to this app.
 *
 * Resolution order:
 *   1. `BETTER_AUTH_URL`          — explicit override (required in production)
 *   2. `https://$VERCEL_URL`      — Vercel preview deployments
 *   3. `http://localhost:$PORT`   — local dev (PORT defaults to 3000)
 *
 * If you run `next dev` on a non-default port, set `PORT=3001` (or whatever)
 * in `.env.local` alongside the `-p` flag, or set `BETTER_AUTH_URL` directly.
 */
export function getBaseURL(): string {
  if (process.env.BETTER_AUTH_URL) return process.env.BETTER_AUTH_URL
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`
  return `http://localhost:${process.env.PORT ?? 3000}`
}

/**
 * Stable production URL registered as the GitHub OAuth app's callback. The
 * `oAuthProxy` plugin uses this to bounce preview-deploy sign-ins through a
 * single stable callback and then redirect back to the preview URL.
 */
export function getProductionURL(): string {
  if (!process.env.BETTER_AUTH_PRODUCTION_URL) {
    throw new Error(
      "BETTER_AUTH_PRODUCTION_URL is not set. Set it to the URL registered with the GitHub OAuth app (e.g. https://build.screenplay.space).",
    )
  }
  return process.env.BETTER_AUTH_PRODUCTION_URL
}
