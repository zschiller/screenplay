import { describe, expect, it } from "vitest"

import {
  awaitDeviceAuthorization,
  DEVICE_CODE_URL,
  DEVICE_TOKEN_URL,
  pollDeviceFlowOnce,
  requestDeviceCode,
  type DeviceAuthorization,
  type DeviceFlowTransport,
} from "@/lib/github-local/device-flow"

/** A transport that replays canned token-endpoint responses in order. */
function scriptedTransport(responses: Record<string, unknown>[]): {
  transport: DeviceFlowTransport
  calls: { url: string; params: Record<string, string> }[]
} {
  const calls: { url: string; params: Record<string, string> }[] = []
  const queue = [...responses]
  return {
    calls,
    transport: async (url, params) => {
      calls.push({ url, params })
      const next = queue.shift()
      if (!next) throw new Error("transport called more times than scripted")
      return next
    },
  }
}

function grant(
  overrides: Partial<DeviceAuthorization> = {}
): DeviceAuthorization {
  return {
    deviceCode: "dev-code",
    userCode: "ABCD-1234",
    verificationUri: "https://github.com/login/device",
    expiresInSeconds: 900,
    intervalSeconds: 5,
    ...overrides,
  }
}

const noSleep = async () => {}

describe("requestDeviceCode", () => {
  it("surfaces the user code, verification URL, and polling contract", async () => {
    const { transport, calls } = scriptedTransport([
      {
        device_code: "dev-code",
        user_code: "ABCD-1234",
        verification_uri: "https://github.com/login/device",
        expires_in: 899,
        interval: 5,
      },
    ])

    const result = await requestDeviceCode(transport, {
      clientId: "client-1",
      scopes: ["repo"],
    })

    expect(result).toEqual({
      deviceCode: "dev-code",
      userCode: "ABCD-1234",
      verificationUri: "https://github.com/login/device",
      expiresInSeconds: 899,
      intervalSeconds: 5,
    })
    expect(calls[0].url).toBe(DEVICE_CODE_URL)
    expect(calls[0].params).toEqual({ client_id: "client-1", scope: "repo" })
  })

  it("throws with GitHub's explanation on a malformed grant", async () => {
    const { transport } = scriptedTransport([
      { error: "unauthorized_client", error_description: "bad client id" },
    ])
    await expect(
      requestDeviceCode(transport, { clientId: "nope" })
    ).rejects.toThrow(/bad client id/)
  })
})

describe("awaitDeviceAuthorization", () => {
  it("polls through pending to the authorized token + scopes", async () => {
    const { transport, calls } = scriptedTransport([
      { error: "authorization_pending" },
      { error: "authorization_pending" },
      { access_token: "gho_tok", scope: "repo,read:org" },
    ])
    const sleeps: number[] = []

    const outcome = await awaitDeviceAuthorization(transport, {
      clientId: "client-1",
      grant: grant(),
      sleep: async (s) => {
        sleeps.push(s)
      },
    })

    expect(outcome).toEqual({
      status: "authorized",
      token: "gho_tok",
      scopes: ["repo", "read:org"],
    })
    // Each pending poll waited out the grant's interval before the next.
    expect(sleeps).toEqual([5, 5])
    expect(calls.every((c) => c.url === DEVICE_TOKEN_URL)).toBe(true)
    expect(calls[0].params.device_code).toBe("dev-code")
  })

  it("backs off when GitHub says slow_down", async () => {
    const { transport } = scriptedTransport([
      { error: "slow_down", interval: 12 },
      { error: "authorization_pending" },
      { access_token: "gho_tok", scope: "" },
    ])
    const sleeps: number[] = []

    const outcome = await awaitDeviceAuthorization(transport, {
      clientId: "client-1",
      grant: grant(),
      sleep: async (s) => {
        sleeps.push(s)
      },
    })

    expect(outcome.status).toBe("authorized")
    // The widened interval applies from the slow_down onward.
    expect(sleeps).toEqual([12, 12])
  })

  it("ends as denied when the user refuses", async () => {
    const { transport } = scriptedTransport([{ error: "access_denied" }])
    const outcome = await awaitDeviceAuthorization(transport, {
      clientId: "client-1",
      grant: grant(),
      sleep: noSleep,
    })
    expect(outcome).toEqual({ status: "denied" })
  })

  it("ends as expired when GitHub expires the code", async () => {
    const { transport } = scriptedTransport([{ error: "expired_token" }])
    const outcome = await awaitDeviceAuthorization(transport, {
      clientId: "client-1",
      grant: grant(),
      sleep: noSleep,
    })
    expect(outcome).toEqual({ status: "expired" })
  })

  it("gives up at the grant's expiry even without an expired_token reply", async () => {
    // Three pending polls at 5s against a 12s lifetime: the fold must stop
    // before the third sleep would cross the deadline.
    const { transport, calls } = scriptedTransport([
      { error: "authorization_pending" },
      { error: "authorization_pending" },
      { error: "authorization_pending" },
    ])

    const outcome = await awaitDeviceAuthorization(transport, {
      clientId: "client-1",
      grant: grant({ expiresInSeconds: 12 }),
      sleep: noSleep,
    })

    expect(outcome).toEqual({ status: "expired" })
    expect(calls.length).toBeLessThanOrEqual(3)
  })

  it("surfaces an unrecognized protocol error", async () => {
    const { transport } = scriptedTransport([
      { error: "unsupported_grant_type", error_description: "nope" },
    ])
    const outcome = await awaitDeviceAuthorization(transport, {
      clientId: "client-1",
      grant: grant(),
      sleep: noSleep,
    })
    expect(outcome).toEqual({ status: "error", message: "nope" })
  })
})

describe("pollDeviceFlowOnce", () => {
  it("treats a transport failure as pending, not terminal", async () => {
    const transport: DeviceFlowTransport = async () => {
      throw new Error("offline")
    }
    expect(
      await pollDeviceFlowOnce(transport, {
        clientId: "client-1",
        deviceCode: "dev-code",
      })
    ).toEqual({ status: "pending" })
  })
})
