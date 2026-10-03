import { describe, expect, it } from "vitest"

import type { DriveOp } from "@/lib/frame-drive/contract"
import { routeChatDriver } from "@/lib/frame-drive/hosted/router"
import type { FrameDriver } from "@/lib/frame-drive/tools"

/** A driver that records what it was asked to do. */
function fakeDriver(name: string, calls: string[]): FrameDriver {
  return {
    run: async (id) => {
      calls.push(`${name}.run ${id}`)
      return { status: "done", value: { op: "click", path: "/" } }
    },
    start: async (id, opts) => {
      calls.push(`${name}.start ${id} ${opts.pace}`)
      return { status: "driving" }
    },
    screenshot: async (id) => {
      calls.push(`${name}.screenshot ${id}`)
      return { status: "unavailable", reason: name }
    },
    frameUnavailable: async (id) => {
      calls.push(`${name}.frameUnavailable ${id}`)
      return null
    },
    letGo: async (id) => {
      calls.push(`${name}.letGo ${id}`)
    },
    canvasUnavailable: async () => name,
  }
}

const CLICK: DriveOp = { op: "click", target: { text: "Save" } }

function router(opts: { shared?: FrameDriver; revealFails?: boolean } = {}) {
  const calls: string[] = []
  const driver = routeChatDriver({
    shared: opts.shared ?? fakeDriver("shared", calls),
    mockups: fakeDriver("mockups", calls),
    isMockup: async (id) => id.startsWith("mockup"),
    isLiveMockup: async (id) => id.startsWith("mockup-live"),
    canvas: {
      reveal: async (id) => {
        calls.push(`reveal ${id}`)
        if (opts.revealFails) throw new Error("canvas closed")
        return null
      },
    },
  })
  return { driver, calls }
}

describe("a hosted chat's driver", () => {
  it("sends a live Mockup to its shared browser", async () => {
    const { driver, calls } = router()
    await driver.run("mockup-live-1", CLICK)
    await driver.screenshot("mockup-live-1")
    expect(calls).toEqual([
      "shared.run mockup-live-1",
      "shared.screenshot mockup-live-1",
    ])
  })

  it("sends a Mockup to the asker's view and a frame to its shared browser", async () => {
    const { driver, calls } = router()
    await driver.run("mockup-1", CLICK)
    await driver.run("frame-1", CLICK)
    await driver.screenshot("mockup-1")
    await driver.screenshot("frame-1")
    await driver.frameUnavailable("mockup-1")
    await driver.frameUnavailable("frame-1")
    await driver.letGo("mockup-1")
    await driver.letGo("frame-1")
    expect(calls).toEqual([
      "mockups.run mockup-1",
      "shared.run frame-1",
      "mockups.screenshot mockup-1",
      "shared.screenshot frame-1",
      "mockups.frameUnavailable mockup-1",
      "shared.frameUnavailable frame-1",
      "mockups.letGo mockup-1",
      "shared.letGo frame-1",
    ])
  })

  it("brings a shared frame into the asker's view when showing it", async () => {
    const { driver, calls } = router()
    expect(
      await driver.start("frame-1", { asker: "ada", pace: "show" })
    ).toEqual({ status: "driving" })
    expect(calls).toEqual(["shared.start frame-1 show", "reveal frame-1"])
  })

  it("leaves the view alone for a jump, and for a Mockup, whose driver shows it itself", async () => {
    const { driver, calls } = router()
    await driver.start("frame-1", { asker: "ada", pace: "jump" })
    await driver.start("mockup-1", { asker: "ada", pace: "show" })
    expect(calls).toEqual([
      "shared.start frame-1 jump",
      "mockups.start mockup-1 show",
    ])
  })

  it("doesn't move the view when the agent waits for the frame", async () => {
    const calls: string[] = []
    const shared = {
      ...fakeDriver("shared", calls),
      start: async () =>
        ({ status: "wait", driver: "ben", takenOver: false }) as const,
    }
    const { driver, calls: routed } = router({ shared })
    await driver.start("frame-1", { asker: "ada", pace: "show" })
    expect(routed).toEqual([])
  })

  it("still drives when the asker's canvas can't move", async () => {
    const { driver } = router({ revealFails: true })
    expect(
      await driver.start("frame-1", { asker: "ada", pace: "show" })
    ).toEqual({ status: "driving" })
  })

  it("never says the canvas is closed: a shared frame runs without it", async () => {
    expect(await router().driver.canvasUnavailable()).toBeNull()
  })
})
