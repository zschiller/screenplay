import { describe, expect, it } from "vitest"

import {
  createKeyedQueue,
  isNoReply,
  isWakeStatus,
  wakeFollowUps,
  wakeMessage,
  wakesOnTurnEnd,
} from "./coordinator-wake"
import { parseUserMessage } from "./message-markers"
import { planResolutionText } from "./acp/resolution"
import type { AgentMessage } from "./types"

const typed = (content: string): AgentMessage => ({ role: "user", content })
const delegated = (content: string): AgentMessage => ({
  role: "user",
  content,
  delegatedFrom: "room-chat",
})
const prEvent = (): AgentMessage => ({
  role: "user",
  content: "PR #7 was merged.",
  prEvent: { kind: "merged", number: 7 },
})
const wake = (from: string): AgentMessage => ({
  role: "user",
  content: "update",
  wakeFrom: from,
})
const reply = (content: string): AgentMessage => ({
  role: "assistant",
  content,
})
const call = (
  title: string,
  status: "completed" | "failed" = "completed"
): AgentMessage =>
  ({
    role: "tool_call",
    toolCallId: `${title}-${Math.random()}`,
    title,
    kind: "other",
    status,
  }) as AgentMessage

describe("Coordinator wakes (#897)", () => {
  it("names a chat with no repository by its title, without a Workspace link", () => {
    const message = wakeMessage({
      workspaceId: "s-1",
      title: "Pricing sketch",
      status: "completed",
      lastTurn: "Last reply: done",
      sketch: true,
    })
    const { body, wakeFrom } = parseUserMessage(message)
    expect(wakeFrom).toBe("s-1")
    expect(body).toContain(
      'Chat "Pricing sketch" (a chat with no repository) [chat s-1] finished its turn.'
    )
    expect(body).not.toContain("workspace:")
  })

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

  it("on a plan pause, leaves it to the card rather than asking for a line", () => {
    const message = wakeMessage({
      workspaceId: "ws-1",
      title: "Checkout form",
      status: "paused_for_plan",
      lastTurn: "Waiting for the user to approve this plan:\n1. ship it",
    })
    expect(message).toContain(
      "Workspace [Checkout form](workspace:ws-1) is waiting for the user to approve its plan."
    )
    expect(message).toContain("don’t say it’s waiting on a plan")
    expect(message).not.toContain("Tell the user")
  })

  it("asks for a blocker only, never the chat’s result", () => {
    const message = wakeMessage({
      workspaceId: "ws-1",
      title: "Checkout form",
      status: "completed",
      lastTurn: "Last reply:\nFixed.",
    })
    expect(message).toContain("don’t restate its result")
    expect(message).toContain("Write only for a blocker the card can’t show")
    expect(message).not.toContain("a result")
  })

  describe("which turns wake it (Claude Projects: the coordinator hears its own work)", () => {
    it("wakes for a turn on work the Coordinator sent, however it ended", () => {
      const t = [delegated("fix the badge"), reply("Fixed.")]
      for (const status of [
        "completed",
        "aborted",
        "paused_for_plan",
        "failed",
      ] as const) {
        expect(wakesOnTurnEnd(t, status), status).toBe(true)
      }
    })

    it("doesn’t wake for a turn someone typed in the chat, unless it failed", () => {
      const t = [
        delegated("fix the badge"),
        reply("Fixed."),
        typed("open a PR"),
      ]
      expect(wakesOnTurnEnd(t, "completed")).toBe(false)
      expect(wakesOnTurnEnd(t, "aborted")).toBe(false)
      expect(wakesOnTurnEnd(t, "paused_for_plan")).toBe(false)
      expect(wakesOnTurnEnd(t, "failed")).toBe(true)
    })

    it("doesn’t wake for a PR event’s turn, unless it failed", () => {
      const t = [delegated("fix the badge"), reply("Fixed."), prEvent()]
      expect(wakesOnTurnEnd(t, "completed")).toBe(false)
      expect(wakesOnTurnEnd(t, "failed")).toBe(true)
    })

    it("carries the Coordinator’s task through a plan approval", () => {
      const approve = typed(planResolutionText({ approved: true }))
      expect(
        wakesOnTurnEnd([delegated("plan the form"), approve], "completed")
      ).toBe(true)
      expect(
        wakesOnTurnEnd([typed("plan the form"), approve], "completed")
      ).toBe(false)
    })

    it("treats plan feedback as the person taking over", () => {
      const feedback = typed(
        planResolutionText({ approved: false, feedback: "smaller" })
      )
      expect(
        wakesOnTurnEnd([delegated("plan the form"), feedback], "completed")
      ).toBe(false)
    })

    it("doesn’t wake for a chat with no messages", () => {
      expect(wakesOnTurnEnd([], "completed")).toBe(false)
    })
  })

  describe("follow-ups it sent on its own (two-reply rule)", () => {
    it("counts earlier wake turns that started or messaged a chat", () => {
      expect(
        wakeFollowUps([
          typed("build it, then open a PR"),
          call("create_workspaces"),
          wake("ws-1"),
          call("mcp__screenplay__send_to_workspace"),
          call("send_to_chat"),
          wake("ws-1"),
          call("start_chat"),
          wake("ws-1"),
        ])
      ).toBe(2)
    })

    it("leaves out the running turn, wakes that only read, and failed sends", () => {
      expect(
        wakeFollowUps([
          typed("go"),
          wake("ws-1"),
          call("read_canvas"),
          wake("ws-1"),
          call("send_to_workspace", "failed"),
          wake("ws-1"),
          call("send_to_workspace"),
        ])
      ).toBe(0)
    })

    it("starts over when the user writes", () => {
      expect(
        wakeFollowUps([
          wake("ws-1"),
          call("send_to_workspace"),
          wake("ws-1"),
          call("send_to_workspace"),
          typed("keep going"),
          call("send_to_workspace"),
          wake("ws-1"),
        ])
      ).toBe(0)
    })
  })

  it("recognizes the stock lines a harness writes when a wake needs no answer (#1224)", () => {
    for (const line of [
      "No response requested.",
      "No response needed.",
      "no reply needed",
      "  No response requested.\n",
      "(No response requested)",
      "*No response required.*",
      "Nothing to add.",
      "No action needed.",
      "",
      "   ",
    ]) {
      expect(isNoReply(line), JSON.stringify(line)).toBe(true)
    }
    for (const reply of [
      "No.",
      "Checkout is ready.",
      "No response from the Workspace yet; it may be stuck.",
      "No tests failed.",
    ]) {
      expect(isNoReply(reply), reply).toBe(false)
    }
  })

  it("runs one Room’s wakes one at a time, in order, and other Rooms' alongside", async () => {
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
