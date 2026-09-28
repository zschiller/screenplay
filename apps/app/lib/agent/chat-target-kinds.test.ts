import { describe, expect, it } from "vitest"

import {
  agentChatTarget,
  markdownLayerChatTarget,
  roomChatTarget,
  type ChatTargetSpec,
} from "@/lib/agent/chat-target-kinds"
import { PLAN_MODE_MARKER } from "@/lib/agent/message-markers"

const MESSAGE = "bold the dates"

// The decorator's signature is independent of the spec's target/context type
// params, so this picks out just that field's type and sidesteps the variance
// of `loadContext`/`buildTools` when handing either spec to the helper below.
type Decorator = ChatTargetSpec<never, never>["decorateUserMessage"]

const decorate = (
  decorator: Decorator,
  opts: { planMode?: boolean; branch?: string; isFirstMessage: boolean }
) => decorator?.(MESSAGE, opts) ?? MESSAGE

/**
 * Turn-marker decoration is per target kind: a marker only belongs on a
 * message whose target has something to do with it. A document chat has no
 * `submit_plan` gate and no branch, so it gets a bare message (#743).
 */
describe("decorateUserMessage — per target kind", () => {
  it("prepends the plan marker for a sandbox-backed agent chat", () => {
    const out = decorate(agentChatTarget.decorateUserMessage, {
      planMode: true,
      isFirstMessage: false,
    })

    expect(out).toContain(PLAN_MODE_MARKER)
    expect(out).toContain(MESSAGE)
  })

  it("leaves a document chat's message undecorated even with plan mode on", () => {
    const out = decorate(markdownLayerChatTarget.decorateUserMessage, {
      planMode: true,
      isFirstMessage: true,
    })

    expect(out).toBe(MESSAGE)
    expect(out).not.toContain(PLAN_MODE_MARKER)
  })

  it("leaves a Room Target chat's message undecorated", () => {
    const out = decorate(roomChatTarget.decorateUserMessage, {
      planMode: true,
      branch: "feat/x",
      isFirstMessage: true,
    })

    expect(out).toBe(MESSAGE)
  })

  it("doesn't leak the branch marker into a document chat's first message", () => {
    const out = decorate(markdownLayerChatTarget.decorateUserMessage, {
      branch: "feat/x",
      isFirstMessage: true,
    })

    expect(out).toBe(MESSAGE)
  })
})

/**
 * The `room` kind (the Coordinator): the whole canvas as context and the
 * Coordinator tools module as its tool set, with no sandbox or document tools.
 */
describe("room chat target", () => {
  it("is its own kind", () => {
    expect(roomChatTarget.kind).toBe("room")
  })

  it("bakes the canvas summary into its system prompt", () => {
    const prompt = roomChatTarget.buildSystemPrompt(
      { canvasSummary: 'Documents (1):\n- [doc-1] "Launch spec"' },
      {}
    )

    expect(prompt).toContain("Coordinator")
    expect(prompt).toContain('- [doc-1] "Launch spec"')
    expect(prompt).toContain("read_canvas")
  })

  it("runs with the canvas reader and the shared document reader only", () => {
    const tools = roomChatTarget.buildTools("room-1", { userId: "user-1" })

    expect(Object.keys(tools).sort()).toEqual(["read_canvas", "read_document"])
  })
})
