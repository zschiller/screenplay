import "server-only"

import { isSandboxRunning, sandboxProvider } from "@/lib/sandbox"
import { PROXY_PORT_OFFSET } from "@/lib/sandbox/provision-internals"

/**
 * What a single preview probe observed:
 *
 *  - `"ready"` — the dev server itself answered (any non-5xx, or a redirect).
 *  - `"upstream-refused"` — the bridge proxy is up and served its placeholder
 *    because the dev server refused the connection (nothing listening on the
 *    resolved dev port). On the local backend this is the signature of a dev
 *    server that never bound the port portless assigned it (a script that
 *    ignores `$PORT`, or portless itself failing to launch).
 *  - `"unreachable"` — nothing answered at all (the proxy itself is down, or
 *    the placeholder reported some other upstream failure).
 *
 * The placeholder self-identifies via `x-screenplay-proxy` /
 * `x-screenplay-upstream-error` headers (see servePlaceholder in proxy.mjs).
 *
 * Only ever called with a preview's internal address
 * ({@link SandboxInstance.internalUrl}), never a browser URL.
 */
export type PreviewProbeResult = "ready" | "upstream-refused" | "unreachable"

export async function probePreview(url: string): Promise<PreviewProbeResult> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "text/html" },
    })
    // Don't consume the body — reachability is all we need, and the iframe
    // re-fetches the URL itself. Discard the stream so the connection frees.
    res.body?.cancel().catch(() => {})
    // `redirect: "manual"` surfaces a 3xx as an opaque-redirect response; either
    // way, anything that isn't a 5xx proxy placeholder means the server is up.
    if (
      res.type === "opaqueredirect" ||
      (res.status >= 200 && res.status < 500)
    ) {
      return "ready"
    }
    const isPlaceholder =
      res.headers?.get?.("x-screenplay-proxy") === "placeholder"
    const upstreamError = res.headers?.get?.("x-screenplay-upstream-error")
    return isPlaceholder && upstreamError === "ECONNREFUSED"
      ? "upstream-refused"
      : "unreachable"
  } catch {
    return "unreachable"
  }
}

/**
 * Check if a preview's internal address answers. The bridge proxy serves its
 * "dev server not ready" placeholder with a 5xx status (see servePlaceholder
 * in proxy.mjs), so any non-5xx response means the dev server itself answered.
 *
 * Deliberately lightweight: it does NOT download or parse the page body, so a
 * warm preview isn't fetched twice in series (here, then by the iframe). A
 * redirect (e.g. "/" -> "/login") is a live server too, so it's treated as
 * reachable instead of following the chain.
 */
export async function probePreviewUrl(url: string): Promise<boolean> {
  return (await probePreview(url)) === "ready"
}

/**
 * How long a Sandbox's internal preview address is remembered. Resolving it
 * on the hosted backend is a Vercel API call, and the client probes every few
 * seconds; a failed probe forgets it at once, so a recreated Sandbox's new
 * address is picked up on the next probe.
 */
const INTERNAL_URL_TTL_MS = 60_000

const KEY = Symbol.for("screenplay.previewInternalUrls")
type Host = { [KEY]?: Map<string, { url: string; at: number }> }
const cache = () => ((globalThis as Host)[KEY] ??= new Map())

/**
 * The bridge proxy's internal address for a Workspace's Sandbox and Dev
 * Server Port, or null when the Sandbox is missing or stopped (resolving it
 * never wakes one).
 */
export async function previewInternalUrl(
  sandboxName: string,
  devPort: number
): Promise<string | null> {
  const key = `${sandboxName}:${devPort}`
  const hit = cache().get(key)
  if (hit && Date.now() - hit.at < INTERNAL_URL_TTL_MS) return hit.url
  try {
    const sandbox = await sandboxProvider.get({
      name: sandboxName,
      resume: false,
    })
    if (!isSandboxRunning(sandbox)) return null
    const url = sandbox.internalUrl(devPort + PROXY_PORT_OFFSET)
    cache().set(key, { url, at: Date.now() })
    return url
  } catch {
    return null
  }
}

/** Drop what {@link previewInternalUrl} remembers for a Sandbox. */
export function forgetPreviewInternalUrl(sandboxName: string): void {
  for (const key of cache().keys()) {
    if (key.startsWith(`${sandboxName}:`)) cache().delete(key)
  }
}
