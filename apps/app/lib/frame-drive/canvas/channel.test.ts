import { describe, expect, it } from "vitest"

import type { DriveOp } from "@/lib/frame-drive/contract"
import {
  askerCanvas,
  type CanvasTransport,
} from "@/lib/frame-drive/canvas/channel"
import type {
  CanvasAnswer,
  ServerToCanvas,
} from "@/lib/frame-drive/canvas/protocol"

/** A transport that answers each message with `answer`, recording it. */
function transport(
  answer: (message: ServerToCanvas) => CanvasAnswer | string
): CanvasTransport & {
  sent: { message: ServerToCanvas; timeoutMs: number }[]
} {
  const sent: { message: ServerToCanvas; timeoutMs: number }[] = []
  return {
    sent,
    async ask(message, timeoutMs) {
      sent.push({ message, timeoutMs })
      return answer(message)
    },
  }
}

const CLICK: DriveOp = { op: "click", target: { selector: "#save" } }
const WHERE = {
  rect: { x: 0, y: 0, width: 10, height: 10 },
  window: { width: 100, height: 100 },
  zoom: 1,
  visibility: "visible",
}

describe("the asker’s canvas", () => {
  it("sends each kind of message with its own timeout", async () => {
    const t = transport(() => "away")
    const canvas = askerCanvas(t, {
      opTimeoutMs: 1,
      readTimeoutMs: 2,
      revealTimeoutMs: 3,
    })
    await canvas.run("f1", CLICK)
    await canvas.where("f1")
    await canvas.snapshot("f1")
    await canvas.reveal("f1")
    expect(t.sent.map((s) => [s.message.type, s.timeoutMs])).toEqual([
      ["op", 1],
      ["where", 2],
      ["snapshot", 2],
      ["reveal", 3],
    ])
    expect(new Set(t.sent.map((s) => s.message.id)).size).toBe(4)
  })

  it("reads each answer", async () => {
    const canvas = askerCanvas(
      transport((m): CanvasAnswer => {
        switch (m.type) {
          case "op":
            return { type: "result", id: m.id, result: { status: "taken" } }
          case "where":
            return { type: "where", id: m.id, where: WHERE }
          case "snapshot":
            return { type: "snapshot", id: m.id, snapshot: null }
          case "reveal":
            return { type: "revealed", id: m.id, ok: true }
          case "page":
            return {
              type: "page",
              id: m.id,
              value: m.ask.kind === "state" ? { path: "/x" } : "unsupported",
            }
        }
      })
    )
    expect(await canvas.page("f1", { kind: "state" })).toEqual({ path: "/x" })
    // A frame that can't take real input is the bridge's to play.
    await expect(canvas.page("f1", { kind: "take" })).rejects.toThrow(
      /isn’t loaded/
    )
    expect(await canvas.run("f1", CLICK)).toEqual({ status: "taken" })
    expect(await canvas.where("f1")).toEqual(WHERE)
    expect(await canvas.snapshot("f1")).toMatch(/isn’t loaded/)
    expect(await canvas.reveal("f1")).toBeNull()
  })

  it("passes on why the canvas didn’t answer", async () => {
    const canvas = askerCanvas(transport(() => "The canvas isn’t open."))
    expect(await canvas.run("f1", CLICK)).toEqual({
      status: "unavailable",
      reason: "The canvas isn’t open.",
    })
    expect(await canvas.where("f1")).toBe("The canvas isn’t open.")
    expect(await canvas.snapshot("f1")).toBe("The canvas isn’t open.")
    expect(await canvas.reveal("f1")).toBe("The canvas isn’t open.")
  })

  it("refuses an answer of the wrong kind", async () => {
    const canvas = askerCanvas(
      transport((m) => ({ type: "revealed", id: m.id, ok: true }))
    )
    expect(await canvas.run("f1", CLICK)).toMatchObject({ status: "failed" })
    expect(await canvas.where("f1")).toMatch(/unexpected/)
    expect(await canvas.snapshot("f1")).toMatch(/unexpected/)
  })

  it("says so when the canvas couldn’t bring the frame into view", async () => {
    const canvas = askerCanvas(
      transport((m) => ({ type: "revealed", id: m.id, ok: false }))
    )
    expect(await canvas.reveal("f1")).toMatch(/couldn’t bring it into view/)
  })

  it("never sends an op outside the contract", async () => {
    const t = transport(() => "away")
    const result = await askerCanvas(t).run("f1", {
      op: "eval",
    } as unknown as DriveOp)
    expect(result).toEqual({ status: "failed", reason: "unknown drive op" })
    expect(t.sent).toEqual([])
  })
})
