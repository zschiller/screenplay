import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type {
  ViewerAnswer,
  ViewerIdentity,
  ViewerPerson,
  ViewerRequest,
} from "@/lib/viewer-identity/types"

const run = promisify(execFile)

/** The id person ids are namespaced by: `tailscale:<login>`. */
export const TAILSCALE_ID = "tailscale"

/** How long a `tailscale whois` may take before the lookup counts as broken. */
const WHOIS_TIMEOUT_MS = 5_000

/** What a viewer Tailscale can't name sees. */
export const NOT_ON_TAILNET_MESSAGE =
  "Open this link on a device signed in to Tailscale on the same tailnet."

/** What a viewer on a tagged device sees: Tailscale names no person for it. */
export const TAGGED_DEVICE_MESSAGE =
  "This device is tagged in Tailscale, so it isn’t signed in as a person. Open this link on a device signed in as you."

/**
 * **Tailscale** identity (#1931), checked against Tailscale's own source
 * (`ipn/ipnlocal/serve.go`, `cmd/tailscale/cli/whois.go`):
 *
 * - Behind `tailscale serve`, which proxies from this machine, the person is
 *   in the `Tailscale-User-Login`, `-Name` and `-Profile-Pic` headers. Serve
 *   deletes any copies a client sent before it sets them, and sets none for
 *   Funnel, tagged devices, callers outside the tailnet or this machine.
 *   Names that aren't ASCII arrive RFC 2047 Q-encoded.
 * - A caller reaching the listener directly over the tailnet is looked up
 *   with `tailscale whois --json <address>`, which fails for an address
 *   outside the tailnet.
 *
 * A loopback caller without the headers is this machine, or Funnel: refused.
 */
export function tailscaleIdentity(
  options: { command?: string } = {}
): ViewerIdentity {
  const command = options.command ?? "tailscale"
  return {
    cacheKey(request) {
      if (isLoopback(request.remoteAddress)) {
        const login = request.headers.get("tailscale-user-login")
        return login
          ? `serve:${login}\n${request.headers.get("tailscale-user-name") ?? ""}\n${request.headers.get("tailscale-user-profile-pic") ?? ""}`
          : null
      }
      return `whois:${request.remoteAddress}`
    },
    async identify(request) {
      if (isLoopback(request.remoteAddress)) return fromServeHeaders(request)
      return whois(command, request.remoteAddress)
    },
  }
}

function fromServeHeaders(request: ViewerRequest): ViewerAnswer {
  const login = decodeHeader(request.headers.get("tailscale-user-login"))
  if (!login) return refused(NOT_ON_TAILNET_MESSAGE)
  return identified({
    login,
    name: decodeHeader(request.headers.get("tailscale-user-name")),
    picture: request.headers.get("tailscale-user-profile-pic") ?? "",
  })
}

async function whois(command: string, address: string): Promise<ViewerAnswer> {
  const peer = address.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "")
  let stdout: string
  try {
    ;({ stdout } = await run(command, ["whois", "--json", peer], {
      timeout: WHOIS_TIMEOUT_MS,
    }))
  } catch (err) {
    // A missing command is a broken lookup; anything else is Tailscale
    // saying the address isn't on the tailnet.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${command} isn’t installed or isn’t on PATH`)
    }
    return refused(NOT_ON_TAILNET_MESSAGE)
  }
  let who: {
    Node?: { Tags?: string[] | null }
    UserProfile?: {
      LoginName?: string
      DisplayName?: string
      ProfilePicURL?: string
    }
  }
  try {
    who = JSON.parse(stdout)
  } catch {
    throw new Error(`${command} whois printed something that isn’t JSON`)
  }
  if (who.Node?.Tags?.length) return refused(TAGGED_DEVICE_MESSAGE)
  const login = who.UserProfile?.LoginName
  if (!login) return refused(NOT_ON_TAILNET_MESSAGE)
  return identified({
    login,
    name: who.UserProfile?.DisplayName ?? "",
    picture: who.UserProfile?.ProfilePicURL ?? "",
  })
}

function identified(who: {
  login: string
  name: string
  picture: string
}): ViewerAnswer {
  const person: ViewerPerson = {
    id: who.login.toLowerCase(),
    name: who.name || who.login,
    ...(who.login.includes("@") && { email: who.login }),
    ...(/^https?:\/\//.test(who.picture) && { avatarUrl: who.picture }),
  }
  return { person, ttlSeconds: 300 }
}

function refused(message: string): ViewerAnswer {
  // Ask again next time: they may have signed in to Tailscale since.
  return { person: null, message, ttlSeconds: 0 }
}

function isLoopback(address: string): boolean {
  return address === "::1" || /^(::ffff:)?127\./i.test(address)
}

/**
 * A header value as `tailscale serve` writes it: plain ASCII, or RFC 2047
 * Q-encoded words (`=?utf-8?q?Zo=C3=AB?=`) for anything else.
 */
export function decodeHeader(value: string | null): string {
  if (!value) return ""
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(
      /=\?([^?]+)\?([qQbB])\?([^?]*)\?=/g,
      (_word, charset: string, encoding: string, text: string) => {
        const bytes =
          encoding.toLowerCase() === "b"
            ? Buffer.from(text, "base64")
            : Buffer.from(
                text
                  .replace(/_/g, " ")
                  .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) =>
                    String.fromCharCode(parseInt(hex, 16))
                  ),
                "latin1"
              )
        return charset.toLowerCase().replace("-", "") === "utf8"
          ? bytes.toString("utf8")
          : bytes.toString("latin1")
      }
    )
    .trim()
}
