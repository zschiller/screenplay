/**
 * URL prefix the product is mounted under. The marketing `web` app owns the
 * apex domain and proxies `/app/*` here (see `apps/web/vercel.json`); Next.js
 * `basePath` (`apps/app/next.config.mjs`) then makes the product serve every
 * page, asset, and route handler beneath this prefix.
 *
 * Keep this in sync with the `basePath` literal in `next.config.mjs` — that
 * file is plain Node config loaded before the TS pipeline, so it can't import
 * this module.
 */
export const BASE_PATH = "/app"

/**
 * Where Better Auth mounts its handler. Better Auth's `basePath` is the full
 * path that precedes each endpoint (e.g. `/sign-in/social`), so under the
 * product's `/app` prefix it must be `/app/api/auth` — matching the route
 * handler at `app/api/auth/[...all]/route.ts` once Next applies `basePath`.
 */
export const AUTH_BASE_PATH = `${BASE_PATH}/api/auth`
