import { describe, expect, it } from "vitest"

import {
  agentChatTarget,
  markdownLayerChatTarget,
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

  it("doesn't leak the branch marker into a document chat's first message", () => {
    const out = decorate(markdownLayerChatTarget.decorateUserMessage, {
      branch: "feat/x",
      isFirstMessage: true,
    })

    expect(out).toBe(MESSAGE)
  })
})
