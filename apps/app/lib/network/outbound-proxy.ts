/**
 * Outbound network on a locked-down box (#1929): a company proxy every request
 * off the machine has to go through, and a company certificate authority that
 * proxy (or an internal host) signs with.
 *
 * Both reach the server as **environment**, set by the start script before
 * Node boots, never by app code at runtime: Node reads `NODE_EXTRA_CA_CERTS`
 * and `NODE_USE_ENV_PROXY` once at startup, and the same variables carry on to
 * everything the server spawns (coding CLIs, git, previews' installs and dev
 * servers). `outboundProxyEnv` spells out that environment from a proxy and
 * CA; `chromiumNetworkArgs` reads it back for the thumbnail browser,
 * so the environment stays the one source of truth.
 */

/** A proxy and CA, as `outboundProxyEnv` takes them. */
export type OutboundProxySettings = {
  /** The proxy every off-box request goes through, e.g. `http://proxy.corp:3128`. */
  url?: string
  /** Hosts reached directly, not through the proxy. Loopback always is. */
  noProxy?: string[]
  /** A PEM file of extra certificate authorities to trust (the company CA). */
  caFile?: string
}

/**
 * Loopback is never proxied: previews, the Yjs host and the server's own checks
 * all live on this machine, and a company proxy can't reach them.
 */
const LOOPBACK_NO_PROXY = ["localhost", "127.0.0.1", "::1", ".localhost"]

/**
 * The environment that sends server requests through the proxy and trusts the
 * CA. Both spellings of each proxy variable are set, because tools disagree on
 * which wins (curl and git read lowercase first, Node's own parser uppercase).
 * Settings left out set nothing, so a box with only a CA gets only the CA.
 */
export function outboundProxyEnv(
  settings: OutboundProxySettings
): Record<string, string> {
  const env: Record<string, string> = {}
  if (settings.url) {
    env.HTTPS_PROXY = env.https_proxy = settings.url
    env.HTTP_PROXY = env.http_proxy = settings.url
    const noProxy = [
      ...new Set([...LOOPBACK_NO_PROXY, ...(settings.noProxy ?? [])]),
    ].join(",")
    env.NO_PROXY = env.no_proxy = noProxy
    // Node's own `fetch` and `http(s)` ignore the proxy variables unless told
    // to read them (Node 22.21 and later).
    env.NODE_USE_ENV_PROXY = "1"
  }
  if (settings.caFile) env.NODE_EXTRA_CA_CERTS = settings.caFile
  return env
}

type Env = Readonly<Record<string, string | undefined>>

function pick(env: Env, name: string): string | undefined {
  return env[name] || env[name.toLowerCase()] || undefined
}

/**
 * Chromium flags that send the thumbnail browser through the same proxy as the
 * server. Chromium bypasses loopback on its own; `NO_PROXY` hosts join it.
 * Chromium doesn't read `NODE_EXTRA_CA_CERTS`, so trusting the CA is the
 * capturer's job (it fetches off-box requests through Node, which does).
 */
export function chromiumNetworkArgs(env: Env): string[] {
  const proxy = pick(env, "HTTPS_PROXY") ?? pick(env, "HTTP_PROXY")
  if (!proxy) return []
  const args = [`--proxy-server=${proxy}`]
  const bypass = (pick(env, "NO_PROXY") ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean)
    // Chromium's bypass list matches a leading-dot suffix as `*.suffix`.
    .map((host) => (host.startsWith(".") ? `*${host}` : host))
  if (bypass.length > 0) args.push(`--proxy-bypass-list=${bypass.join(";")}`)
  return args
}

/** Whether a company CA is configured, so Chromium can't verify on its own. */
export function hasExtraCa(env: Env): boolean {
  return Boolean(env.NODE_EXTRA_CA_CERTS)
}

/** A host on this machine, which Chromium reaches directly. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase()
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    /^127\.\d+\.\d+\.\d+$/.test(host)
  )
}
