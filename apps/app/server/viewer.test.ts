import { afterEach, describe, expect, it } from "vitest"

import type {
  ViewerAnswer,
  ViewerIdentity,
  ViewerRequest,
} from "@/lib/viewer-identity/types"

import {
  BROKEN_LOOKUP_MESSAGE,
  createIdentifier,
  getViewerIdentity,
  setViewerIdentity,
} from "./viewer.mjs"

afterEach(() => setViewerIdentity("none", null))

const request = (email: string): ViewerRequest => ({
  headers: new Headers({ "x-email": email }),
  remoteAddress: "10.0.0.1",
  listener: { name: "tailnet", address: "127.0.0.1", port: 4200 },
})

/** An identity that counts its lookups and answers from `answers`. */
function counting(answers: Record<string, ViewerAnswer>) {
  const calls: string[] = []
  const identity: ViewerIdentity = {
    cacheKey: (r) => r.headers.get("x-email"),
    async identify(r) {
      const email = r.headers.get("x-email")!
      calls.push(email)
      const answer = answers[email]
      if (!answer) throw new Error(`no answer for ${email}`)
      return answer
    },
  }
  return { identity, calls }
}

const ana: ViewerAnswer = {
  person: { id: "ana", name: "Ana" },
  ttlSeconds: 60,
}

describe("the front server's identifier", () => {
  it("namespaces person ids by the implementation the config used", async () => {
    setViewerIdentity("tailscale", counting({ a: ana }).identity)
    const answer = await getViewerIdentity()!.identify(request("a"))
    expect(answer.person?.id).toBe("tailscale:ana")
  })

  it("remembers an answer for its cache key and lifetime", async () => {
    let now = 0
    const { identity, calls } = counting({ a: ana })
    const identify = createIdentifier({
      identity: () => identity,
      now: () => now,
    })
    await identify(request("a"))
    now = 59_000
    await identify(request("a"))
    expect(calls).toEqual(["a"])
    now = 60_001
    await identify(request("a"))
    expect(calls).toEqual(["a", "a"])
  })

  it("asks again for an answer with no lifetime or no key", async () => {
    const refusal: ViewerAnswer = {
      person: null,
      message: "No.",
      ttlSeconds: 0,
    }
    const { identity, calls } = counting({ r: refusal, a: ana })
    const identify = createIdentifier({ identity: () => identity })
    await identify(request("r"))
    await identify(request("r"))
    expect(calls).toEqual(["r", "r"])

    const unkeyed = createIdentifier({
      identity: () => ({ ...identity, cacheKey: () => null }),
    })
    await unkeyed(request("a"))
    await unkeyed(request("a"))
    expect(calls).toEqual(["r", "r", "a", "a"])
  })

  it("refuses and logs when the lookup is broken", async () => {
    const lines: string[] = []
    const { identity } = counting({})
    const identify = createIdentifier({
      identity: () => identity,
      log: (line) => lines.push(line),
    })
    expect(await identify(request("a"))).toEqual({
      person: null,
      message: BROKEN_LOOKUP_MESSAGE,
      ttlSeconds: 0,
    })
    expect(lines).toEqual(["[viewerIdentity] no answer for a"])
  })

  it("refuses everyone when no identity is set", async () => {
    const identify = createIdentifier({ identity: () => undefined })
    expect((await identify(request("a"))).person).toBeNull()
  })
})
