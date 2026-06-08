/**
 * URL prefix the product is mounted under, as a single source of truth.
 *
 * The product is path-agnostic: it can be served at the root of its own domain
 * (the default — a standalone deployer sets nothing) or beneath a prefix when
 * proxied by another origin. In this monorepo the marketing `web` app owns the
 * apex and proxies `/app/*` here (see `apps/web/vercel.json`), so the `app`
 * Vercel project sets `NEXT_PUBLIC_BASE_PATH=/app`.
 *
 * Read from the env (not a literal) so this module and `next.config.mjs` — which
 * can't import TS — stay in lockstep by both reading the same variable instead
 * of duplicating a path. `NEXT_PUBLIC_` so the value is inlined into the client
 * bundle, where `withBasePath` needs it. Normalized to "" or "/seg" (no
 * trailing slash) so callers can always concatenate `${BASE_PATH}${path}`.
 */
function normalize(raw: string | undefined): string {
  if (!raw) return ""
  const trimmed = raw.replace(/\/+$/, "")
  if (!trimmed) return ""
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`
}

export const BASE_PATH = normalize(process.env.NEXT_PUBLIC_BASE_PATH)

/**
 * Prefix a root-relative URL with `BASE_PATH`. Use for every client request
 * Next.js does NOT auto-prefix — `fetch`, `WebSocket`, third-party
 * `authEndpoint`s. (Next only prefixes `<Link>`, `next/image`, the router, and
 * `_next/*` assets.) A no-op when `BASE_PATH` is "", so it's always safe.
 */
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`
}

/**
 * Where Better Auth mounts its handler. Better Auth's `basePath` is the full
 * path that precedes each endpoint (e.g. `/sign-in/social`), so under a mount
 * prefix it must be `${BASE_PATH}/api/auth` — matching the route handler at
 * `app/api/auth/[...all]/route.ts` once Next applies `basePath`.
 */
export const AUTH_BASE_PATH = withBasePath("/api/auth")
