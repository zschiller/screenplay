import { describe, expect, it } from "vitest"

import { createKeyedQueue, isWakeStatus, wakeMessage } from "./coordinator-wake"
import { parseUserMessage } from "./message-markers"

describe("Coordinator wakes (#897)", () => {
  it("wakes on every terminal Workspace run state but a superseded one", () => {
    expect(isWakeStatus("completed")).toBe(true)
    expect(isWakeStatus("failed")).toBe(true)
    expect(isWakeStatus("aborted")).toBe(true)
    expect(isWakeStatus("paused_for_plan")).toBe(true)
    expect(isWakeStatus("superseded")).toBe(false)
    expect(isWakeStatus("running")).toBe(false)
  })

  it("carries the Workspace, how its turn ended and its last turn, behind a marker the chat hides", () => {
    const message = wakeMessage({
      workspaceId: "ws-1",
      title: "Checkout form",
      status: "completed",
      lastTurn: "Last ask: fix it\nLast reply:\nFixed.",
    })
    const parsed = parseUserMessage(message)
    expect(parsed.wakeFrom).toBe("ws-1")
    expect(parsed.body).toContain(
      "Workspace [Checkout form](workspace:ws-1) finished its turn."
    )
    expect(parsed.body).toContain("Last reply:\nFixed.")
    expect(parsed.body).toContain("Otherwise end your turn without writing")
  })

  it("on a plan pause, asks for one line naming and linking the Workspace, and says the user approves", () => {
    const message = wakeMessage({
      workspaceId: "ws-1",
      title: "Checkout form",
      status: "paused_for_plan",
      lastTurn: "Waiting for the user to approve this plan:\n1. ship it",
    })
    expect(message).toContain(
      "Tell the user that [Checkout form](workspace:ws-1) is waiting for them to approve its plan"
    )
    expect(message).toContain("You can't approve plans; the user does.")
  })

  it("runs one Room's wakes one at a time, in order, and other Rooms' alongside", async () => {
    const enqueue = createKeyedQueue()
    const log: string[] = []
    const releases: Record<string, () => void> = {}
    const task = (name: string) => () =>
      new Promise<void>((resolve) => {
        log.push(`start ${name}`)
        releases[name] = () => {
          log.push(`end ${name}`)
          resolve()
        }
      })

    const a1 = enqueue("room-a", task("a1"))
    const a2 = enqueue("room-a", task("a2"))
    const b1 = enqueue("room-b", task("b1"))
    await Promise.resolve()
    await Promise.resolve()
    // a2 waits for a1; room-b's wake doesn't wait for room-a's.
    expect(log).toEqual(["start a1", "start b1"])

    releases.a1()
    await a1
    await new Promise((r) => setTimeout(r, 0))
    expect(log).toEqual(["start a1", "start b1", "end a1", "start a2"])
    releases.a2()
    releases.b1()
    await Promise.all([a2, b1])
  })

  it("keeps going after a wake fails", async () => {
    const enqueue = createKeyedQueue()
    const ran: string[] = []
    const failed = enqueue("room-a", async () => {
      throw new Error("boom")
    })
    const next = enqueue("room-a", async () => {
      ran.push("next")
    })
    await expect(failed).rejects.toThrow("boom")
    await next
    expect(ran).toEqual(["next"])
  })
})
