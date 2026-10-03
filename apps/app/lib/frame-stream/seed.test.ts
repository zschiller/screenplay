// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"

import { seedLocalFrame } from "@/lib/frame-stream/seed"
import type { FrameSnapshot } from "@/lib/frame-stream/protocol"

// The canvas's side of the handshake. The seed page and the cookies it has
// set are the proxy's (`lib/sandbox-bridge/proxy.test.ts`).

const SNAPSHOT: FrameSnapshot = {
  path: "/cart",
  cookies: [
    {
      name: "session",
      value: "s",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: false,
    },
  ],
  localStorage: [["draft", "hello"]],
}

function seedFrame() {
  const frame = document.querySelector("iframe")
  if (!frame?.contentWindow) throw new Error("no seed iframe")
  return frame
}

function fromSeedPage(frame: HTMLIFrameElement, data: object) {
  window.dispatchEvent(
    new MessageEvent("message", { data, source: frame.contentWindow })
  )
}

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ""
})

describe("seedLocalFrame", () => {
  it("hands the seed page the snapshot, on the preview's origin only", async () => {
    const seeded = seedLocalFrame("https://preview.example/app", SNAPSHOT)
    const frame = seedFrame()
    expect(frame.src).toBe("https://preview.example/__screenplay-seed")
    const post = vi.spyOn(frame.contentWindow!, "postMessage")

    // Another window saying it's ready is ignored.
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "screenplay:seed-ready" },
        source: window,
      })
    )
    expect(post).not.toHaveBeenCalled()

    fromSeedPage(frame, { type: "screenplay:seed-ready" })
    expect(post).toHaveBeenCalledWith(
      {
        type: "screenplay:seed",
        cookies: SNAPSHOT.cookies,
        localStorage: SNAPSHOT.localStorage,
      },
      "https://preview.example"
    )
    fromSeedPage(frame, { type: "screenplay:seeded", ok: true })
    expect(await seeded).toBe(true)
    expect(document.querySelector("iframe")).toBeNull()
  })

  it("gives up when the seed page never answers, as on an older Sandbox", async () => {
    vi.useFakeTimers()
    const seeded = seedLocalFrame("https://preview.example", SNAPSHOT, {
      timeoutMs: 100,
    })
    vi.advanceTimersByTime(100)
    expect(await seeded).toBe(false)
    expect(document.querySelector("iframe")).toBeNull()
  })
})
