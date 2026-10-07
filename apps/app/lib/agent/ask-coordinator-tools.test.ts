import { describe, expect, it } from "vitest"

import {
  ASK_COORDINATOR_TOOL,
  buildAskCoordinatorTools,
} from "./ask-coordinator-tools"
import { askMessage, wakeFollowUps } from "./coordinator-wake"
import { parseUserMessage } from "./message-markers"
import { describeToolCall } from "./tool-description"

/** The tool over a port that records what it was asked. */
function chatTools() {
  const asked: string[] = []
  const tools = buildAskCoordinatorTools({
    ask: async (request) => {
      asked.push(request)
    },
  })
  const call = async (request: string) =>
    (await tools[ASK_COORDINATOR_TOOL]!.execute!(
      { request },
      { toolCallId: "t", messages: [], context: {} }
    )) as string
  return { asked, call }
}

describe("ask_coordinator (#1843)", () => {
  it("hands the Coordinator a page change in the chat’s own words", async () => {
    const { asked, call } = chatTools()
    const request =
      "Create a page “Explorations” and move mockup “Pricing take” [mock-1] to it."
    expect(await call(request)).toBe(
      "Sent to the Coordinator. It acts on it with its own tools; you won’t hear back in this turn."
    )
    expect(asked).toEqual([request])
  })

  it("hands it anything else a chat can’t do, such as starting a new chat", async () => {
    const { asked, call } = chatTools()
    await call("  Start a new chat to write the launch email.  ")
    expect(asked).toEqual(["Start a new chat to write the launch email."])
  })

  it("sends nothing for an empty request", async () => {
    const { asked, call } = chatTools()
    expect(await call("   ")).toBe("Not sent: the request is empty.")
    expect(asked).toEqual([])
  })

  it("shows as a row naming the request", () => {
    const row = describeToolCall({
      role: "tool_call",
      toolCallId: "t",
      title: ASK_COORDINATOR_TOOL,
      kind: "other",
      status: "completed",
      content: [],
      rawInput: { request: "Start a new chat for the FAQ" },
    } as never)
    expect(row.label).toEqual({
      verb: "Ask the Coordinator",
      detail: "Start a new chat for the FAQ",
      as: "text",
    })
  })
})

describe("askMessage: the Coordinator turn a chat’s ask starts", () => {
  it("names the asking Workspace, carries the request, and reads as a message from that chat", () => {
    const wire = askMessage({
      workspaceId: "ws-1",
      title: "Checkout polish",
      request: "Move the Checkout group to page “Archive”.",
    })
    const parsed = parseUserMessage(wire)
    expect(parsed.wakeFrom).toBe("ws-1")
    expect(parsed.body).toContain(
      "Workspace [Checkout polish](workspace:ws-1) asks you to do something it can’t do itself."
    )
    expect(parsed.body).toContain("Move the Checkout group to page “Archive”.")
  })

  it("names a chat with no repository by its chat id", () => {
    const wire = askMessage({
      workspaceId: "s-1",
      title: "Pricing sketch",
      request: "Start a new chat for the pricing FAQ.",
      sketch: true,
    })
    const parsed = parseUserMessage(wire)
    expect(parsed.wakeFrom).toBe("s-1")
    expect(parsed.body).toContain(
      'Chat "Pricing sketch" (a chat with no repository) [chat s-1] asks you'
    )
  })

  it("counts toward the follow-ups the Coordinator sends on its own", () => {
    const ask = (id: string) => ({
      role: "user" as const,
      content: "ask",
      wakeFrom: id,
    })
    const started = {
      role: "tool_call" as const,
      toolCallId: "t",
      title: "start_chat",
      kind: "other" as const,
      status: "completed" as const,
      content: [],
    }
    expect(
      wakeFollowUps([ask("s-1"), started, ask("s-1"), started, ask("s-1")])
    ).toBe(2)
  })
})
