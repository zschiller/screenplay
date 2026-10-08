import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterAll, describe, expect, it } from "vitest"

import {
  decodeHeader,
  NOT_ON_TAILNET_MESSAGE,
  TAGGED_DEVICE_MESSAGE,
  tailscaleIdentity,
} from "./tailscale"
import type { ViewerRequest } from "./types"

const dir = mkdtempSync(path.join(tmpdir(), "fake-tailscale-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/**
 * A fake `tailscale` answering `whois --json <address>` the way the real one
 * does (apitype.WhoIsResponse): a person at 100.64.0.2, a tagged server at
 * 100.64.0.3, and "no match for IP" (exit 1) for anyone else.
 */
const fake = path.join(dir, "tailscale")
writeFileSync(
  fake,
  `#!/bin/sh
[ "$1" = whois ] && [ "$2" = --json ] || exit 2
case "$3" in
  100.64.0.2) echo '{"Node":{"ID":1,"Name":"ana-mac.tail1234.ts.net.","Tags":null},"UserProfile":{"ID":7,"LoginName":"Ana@example.com","DisplayName":"Ana Lima","ProfilePicURL":"https://lh3.example/ana.png"},"CapMap":null}' ;;
  100.64.0.3) echo '{"Node":{"ID":2,"Name":"build.tail1234.ts.net.","Tags":["tag:ci"]},"UserProfile":{"ID":9,"LoginName":"tagged-devices","DisplayName":"Tagged Devices"}}' ;;
  *) echo "no match for IP" >&2; exit 1 ;;
esac
`
)
chmodSync(fake, 0o755)

const LISTENER = { name: "tailnet", address: "127.0.0.1", port: 4200 }

function request(
  remoteAddress: string,
  headers: Record<string, string> = {}
): ViewerRequest {
  return { headers: new Headers(headers), remoteAddress, listener: LISTENER }
}

const identity = tailscaleIdentity({ command: fake })

describe("Tailscale viewer identity", () => {
  describe("behind tailscale serve", () => {
    it("names the person in serve's identity headers", async () => {
      expect(
        await identity.identify(
          request("127.0.0.1", {
            "Tailscale-User-Login": "Ana@example.com",
            "Tailscale-User-Name": "Ana Lima",
            "Tailscale-User-Profile-Pic": "https://lh3.example/ana.png",
          })
        )
      ).toEqual({
        person: {
          id: "ana@example.com",
          name: "Ana Lima",
          email: "Ana@example.com",
          avatarUrl: "https://lh3.example/ana.png",
        },
        ttlSeconds: 300,
      })
    })

    it("decodes a name serve Q-encoded", async () => {
      const answer = await identity.identify(
        request("::ffff:127.0.0.1", {
          "Tailscale-User-Login": "zoe@example.com",
          "Tailscale-User-Name": "=?utf-8?q?Zo=C3=AB_M=C3=BCller?=",
        })
      )
      expect(answer.person?.name).toBe("Zoë Müller")
    })

    it("refuses a loopback caller without the headers: this machine, or Funnel", async () => {
      const cases: Record<string, string>[] = [
        {},
        { "Tailscale-Funnel-Request": "?1" },
      ]
      for (const headers of cases) {
        expect(await identity.identify(request("127.0.0.1", headers))).toEqual({
          person: null,
          message: NOT_ON_TAILNET_MESSAGE,
          ttlSeconds: 0,
        })
      }
    })
  })

  describe("reached directly over the tailnet", () => {
    it("asks tailscale whois who the caller is", async () => {
      expect(await identity.identify(request("100.64.0.2"))).toEqual({
        person: {
          id: "ana@example.com",
          name: "Ana Lima",
          email: "Ana@example.com",
          avatarUrl: "https://lh3.example/ana.png",
        },
        ttlSeconds: 300,
      })
    })

    it("ignores identity headers a direct caller sends", async () => {
      const answer = await identity.identify(
        request("100.64.0.2", { "Tailscale-User-Login": "boss@example.com" })
      )
      expect(answer.person?.email).toBe("Ana@example.com")
    })

    it("refuses a caller outside the tailnet", async () => {
      for (const address of ["192.168.1.20", "::ffff:10.0.0.4"]) {
        expect(await identity.identify(request(address))).toEqual({
          person: null,
          message: NOT_ON_TAILNET_MESSAGE,
          ttlSeconds: 0,
        })
      }
    })

    it("refuses a tagged device, which isn't a person", async () => {
      expect(await identity.identify(request("100.64.0.3"))).toEqual({
        person: null,
        message: TAGGED_DEVICE_MESSAGE,
        ttlSeconds: 0,
      })
    })

    it("throws when tailscale isn't installed, so the server logs it", async () => {
      const missing = tailscaleIdentity({
        command: path.join(dir, "no-such-tailscale"),
      })
      await expect(missing.identify(request("100.64.0.2"))).rejects.toThrow(
        "isn’t installed"
      )
    })
  })

  it("keys answers by the caller's address, or by serve's headers", () => {
    expect(identity.cacheKey(request("100.64.0.2"))).toBe("whois:100.64.0.2")
    const ana = request("127.0.0.1", { "Tailscale-User-Login": "ana@x" })
    const bo = request("127.0.0.1", { "Tailscale-User-Login": "bo@x" })
    expect(identity.cacheKey(ana)).not.toBe(identity.cacheKey(bo))
    expect(identity.cacheKey(request("127.0.0.1"))).toBeNull()
  })
})

describe("decodeHeader", () => {
  it("leaves ASCII alone and joins adjacent encoded words", () => {
    expect(decodeHeader("Ana Lima")).toBe("Ana Lima")
    expect(decodeHeader("=?utf-8?q?Jos=C3=A9?= =?utf-8?q?_Mar=C3=ADa?=")).toBe(
      "José María"
    )
    expect(decodeHeader(null)).toBe("")
  })
})
