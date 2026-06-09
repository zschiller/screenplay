/**
 * GitHub OAuth **device flow** client (PRD #428): request a device + user
 * code, surface the user code / verification URL, then poll the token
 * endpoint until the user authorizes in their browser. Chosen over the hosted
 * app's redirect-based OAuth because a desktop app has no stable redirect URI
 * and shouldn't run a callback server.
 *
 * Deliberately a pure protocol module: no global `fetch`, no timers — the
 * transport and sleep are injected, so the whole authorize/poll lifecycle
 * (including `slow_down` backoff and expiry) is unit-testable without a
 * network or a wall clock. Isomorphic by the same token; the server actions
 * supply the real transport.
 */

export const DEVICE_CODE_URL = "https://github.com/login/device/code"
export const DEVICE_TOKEN_URL = "https://github.com/login/oauth/access_token"

/**
 * One form-encoded POST returning GitHub's JSON body. Both device-flow
 * endpoints speak this shape (with `Accept: application/json`).
 */
export type DeviceFlowTransport = (
  url: string,
  params: Record<string, string>
) => Promise<Record<string, unknown>>

/** What `POST /login/device/code` grants: the codes and the polling contract. */
export interface DeviceAuthorization {
  /** Opaque code the app polls the token endpoint with. Never shown. */
  deviceCode: string
  /** Short code the user types at the verification URL. */
  userCode: string
  /** Where the user authorizes (https://github.com/login/device). */
  verificationUri: string
  /** Lifetime of the codes; polling past this yields `expired`. */
  expiresInSeconds: number
  /** Minimum seconds between polls. */
  intervalSeconds: number
}

/** One poll of the token endpoint, decoded into the protocol's states. */
export type DevicePollResult =
  | { status: "authorized"; token: string; scopes: string[] }
  /** User hasn't approved yet — poll again after the interval. */
  | { status: "pending" }
  /** Polled too fast — back off to the returned interval. */
  | { status: "slow-down"; intervalSeconds: number }
  | { status: "denied" }
  | { status: "expired" }
  | { status: "error"; message: string }

/** A finished flow: every {@link DevicePollResult} except the two transients. */
export type DeviceFlowOutcome = Exclude<
  DevicePollResult,
  { status: "pending" } | { status: "slow-down"; intervalSeconds: number }
>

export async function requestDeviceCode(
  transport: DeviceFlowTransport,
  opts: { clientId: string; scopes?: string[] }
): Promise<DeviceAuthorization> {
  const body = await transport(DEVICE_CODE_URL, {
    client_id: opts.clientId,
    ...(opts.scopes && opts.scopes.length > 0
      ? { scope: opts.scopes.join(" ") }
      : {}),
  })
  const deviceCode = body.device_code
  const userCode = body.user_code
  const verificationUri = body.verification_uri
  if (
    typeof deviceCode !== "string" ||
    typeof userCode !== "string" ||
    typeof verificationUri !== "string"
  ) {
    throw new Error(
      `Device code request failed: ${String(body.error_description ?? body.error ?? "malformed response")}`
    )
  }
  return {
    deviceCode,
    userCode,
    verificationUri,
    expiresInSeconds:
      typeof body.expires_in === "number" ? body.expires_in : 900,
    intervalSeconds: typeof body.interval === "number" ? body.interval : 5,
  }
}

export async function pollDeviceFlowOnce(
  transport: DeviceFlowTransport,
  opts: { clientId: string; deviceCode: string }
): Promise<DevicePollResult> {
  let body: Record<string, unknown>
  try {
    body = await transport(DEVICE_TOKEN_URL, {
      client_id: opts.clientId,
      device_code: opts.deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    })
  } catch {
    // A transport failure (offline blip) is transient, not terminal — report
    // pending so the caller simply polls again.
    return { status: "pending" }
  }

  if (typeof body.access_token === "string") {
    return {
      status: "authorized",
      token: body.access_token,
      scopes:
        typeof body.scope === "string" && body.scope !== ""
          ? body.scope.split(/[, ]+/)
          : [],
    }
  }

  switch (body.error) {
    case "authorization_pending":
      return { status: "pending" }
    case "slow_down":
      return {
        status: "slow-down",
        // GitHub returns the new minimum interval; spec fallback is +5s, which
        // the fold applies relative to its current interval.
        intervalSeconds: typeof body.interval === "number" ? body.interval : 0,
      }
    case "access_denied":
      return { status: "denied" }
    case "expired_token":
      return { status: "expired" }
    default:
      return {
        status: "error",
        message: String(
          body.error_description ?? body.error ?? "unknown error"
        ),
      }
  }
}

/**
 * Drive the poll loop to a terminal outcome: poll, wait the interval, repeat —
 * honoring `slow_down` by widening the interval and giving up at the grant's
 * expiry even if GitHub never says `expired_token` itself. Elapsed time is
 * accounted from the injected sleeps (a pure fold), so tests pass a no-op
 * sleep and never wait.
 */
export async function awaitDeviceAuthorization(
  transport: DeviceFlowTransport,
  opts: {
    clientId: string
    grant: DeviceAuthorization
    sleep: (seconds: number) => Promise<void>
  }
): Promise<DeviceFlowOutcome> {
  let intervalSeconds = opts.grant.intervalSeconds
  let elapsedSeconds = 0

  while (true) {
    const result = await pollDeviceFlowOnce(transport, {
      clientId: opts.clientId,
      deviceCode: opts.grant.deviceCode,
    })

    if (result.status === "slow-down") {
      intervalSeconds =
        result.intervalSeconds > 0
          ? result.intervalSeconds
          : intervalSeconds + 5
    } else if (result.status !== "pending") {
      return result
    }

    if (elapsedSeconds + intervalSeconds > opts.grant.expiresInSeconds) {
      return { status: "expired" }
    }
    await opts.sleep(intervalSeconds)
    elapsedSeconds += intervalSeconds
  }
}

/**
 * The production transport: a form-encoded POST via global fetch, asking for
 * (and parsing) JSON. Lives here so the protocol functions above stay
 * transport-free; only the server actions call this.
 */
export const fetchDeviceFlowTransport: DeviceFlowTransport = async (
  url,
  params
) => {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(params).toString(),
  })
  return (await res.json()) as Record<string, unknown>
}
