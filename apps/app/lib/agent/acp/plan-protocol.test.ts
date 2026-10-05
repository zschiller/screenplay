import { describe, expect, it } from "vitest"

import { claudeCodeHarness } from "../harnesses/claude-code"
import { codexHarness } from "../harnesses/codex"
import { opencodeGatewayHarness } from "../harnesses/opencode"
import {
  choosePlanProtocol,
  collaborationMode,
  nativePlanMode,
  replyAsPlan,
  type AdvertisedPlanOptions,
  type PlanControls,
} from "./plan-protocol"
import {
  blockText,
  type RequestPermissionRequest,
  type SessionUpdate,
} from "./schema"

const PLAN = "## Plan\n\n1. Edit the button\n2. Run the tests"

/** What Claude Code's adapter advertises: a native `plan` mode. */
const PLAN_MODES: AdvertisedPlanOptions = {
  modes: {
    availableModes: [
      { id: "default", name: "Default" },
      { id: "plan", name: "Plan" },
    ],
    currentModeId: "default",
  },
}

/** What Codex's adapter advertises: a `collaboration_mode` option. */
const COLLABORATION: AdvertisedPlanOptions = {
  configOptions: [
    {
      id: "collaboration_mode",
      category: "collaboration_mode",
      type: "select",
      currentValue: "default",
      options: [{ value: "default" }, { value: "plan" }],
    },
  ],
}

/** What opencode's adapter advertises: a `mode`-category option. */
const AGENT_MODE: AdvertisedPlanOptions = {
  configOptions: [
    {
      id: "mode",
      category: "mode",
      type: "select",
      currentValue: "build",
      options: [{ value: "build" }, { value: "plan" }],
    },
  ],
}

function reply(messageId: string, text: string): SessionUpdate {
  return {
    sessionUpdate: "agent_message_chunk",
    messageId,
    content: { type: "text", text },
  }
}

function toolCall(id: string): SessionUpdate {
  return { sessionUpdate: "tool_call", toolCallId: id, title: "read" }
}

function permission(
  rawInput: unknown,
  id = "call-1"
): RequestPermissionRequest {
  return {
    sessionId: "sess",
    toolCall: { toolCallId: id, title: "Edit", status: "pending", rawInput },
    options: [
      { optionId: "yes", name: "Yes", kind: "allow_once" },
      { optionId: "no", name: "No", kind: "reject_once" },
    ],
  }
}

function texts(updates: SessionUpdate[]): string[] {
  return updates.flatMap((u) =>
    u.sessionUpdate === "agent_message_chunk" ? [blockText(u.content)] : []
  )
}

/** Controls that record the calls a protocol makes as the session opens. */
function recordingControls(): PlanControls & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    setMode: async (modeId) => void calls.push(`mode=${modeId}`),
    setOption: async (configId, value) =>
      void calls.push(`${configId}=${value}`),
  }
}

const context = { planTurn: true, runId: "run-1", sessionId: "sess" }

describe("choosePlanProtocol", () => {
  it.each([
    ["Claude Code", claudeCodeHarness, PLAN_MODES, "mode"],
    ["Codex", codexHarness, COLLABORATION, "collaboration"],
    ["OpenCode", opencodeGatewayHarness, AGENT_MODE, "reply"],
  ] as const)(
    "picks %s's protocol from its descriptor",
    (_name, harness, advertised, style) => {
      expect(choosePlanProtocol(advertised, harness.acpAdapter!)?.style).toBe(
        style
      )
    }
  )

  it("lets the descriptor win when the agent advertises another way", () => {
    expect(
      choosePlanProtocol(PLAN_MODES, opencodeGatewayHarness.acpAdapter!)?.style
    ).toBe("reply")
    expect(
      choosePlanProtocol(AGENT_MODE, claudeCodeHarness.acpAdapter!)?.style
    ).toBe("mode")
  })

  it("reads an undescribed agent from what it advertises, a plan mode first", () => {
    expect(choosePlanProtocol(PLAN_MODES)?.style).toBe("mode")
    expect(choosePlanProtocol(COLLABORATION)?.style).toBe("collaboration")
    expect(choosePlanProtocol(AGENT_MODE)?.style).toBe("collaboration")
    expect(choosePlanProtocol({ ...PLAN_MODES, ...COLLABORATION })?.style).toBe(
      "mode"
    )
  })

  it("returns null for an agent with no plan support", () => {
    expect(choosePlanProtocol({})).toBeNull()
    expect(
      choosePlanProtocol({
        modes: {
          availableModes: [{ id: "default", name: "Default" }],
          currentModeId: "default",
        },
        configOptions: [
          {
            id: "mode",
            category: "mode",
            currentValue: "build",
            options: [{ value: "build" }],
          },
        ],
      })
    ).toBeNull()
  })

  it("switches the advertised plan mode or option as the session opens", async () => {
    const native = recordingControls()
    await choosePlanProtocol(PLAN_MODES)!.open(true, native)
    expect(native.calls).toEqual(["mode=plan"])

    const codex = recordingControls()
    await choosePlanProtocol(COLLABORATION)!.open(true, codex)
    expect(codex.calls).toEqual(["collaboration_mode=plan"])

    const opencode = recordingControls()
    await choosePlanProtocol(
      AGENT_MODE,
      opencodeGatewayHarness.acpAdapter!
    )!.open(false, opencode)
    expect(opencode.calls).toEqual([])
  })
})

describe("native plan mode", () => {
  it("gates any permission request on a plan turn", () => {
    const turn = nativePlanMode(null).turn(context)
    const request = permission({ file_path: "a.ts" })
    expect(turn.permission(request)).toEqual({
      gate: true,
      updates: [],
      request,
    })
  })

  it("allows every request and holds nothing on another turn", () => {
    const turn = nativePlanMode(null).turn({ ...context, planTurn: false })
    expect(turn.permission(permission({ plan: PLAN }))).toEqual({ gate: false })
    expect(turn.update(reply("m1", "Hi"))).toEqual([reply("m1", "Hi")])
  })

  it("enters plan mode only on a plan turn, when not already in it", async () => {
    const enters = recordingControls()
    await nativePlanMode({ id: "plan", current: "default" }).open(true, enters)
    const stays = recordingControls()
    await nativePlanMode({ id: "plan", current: "default" }).open(false, stays)
    const already = recordingControls()
    await nativePlanMode({ id: "plan", current: "plan" }).open(true, already)

    expect(enters.calls).toEqual(["mode=plan"])
    expect(stays.calls).toEqual([])
    expect(already.calls).toEqual([])
  })
})

describe("collaboration mode", () => {
  const option = {
    configId: "collaboration_mode",
    currentValue: "plan",
    defaultValue: "default",
  }

  it("gates only the request carrying rawInput.plan", () => {
    const turn = collaborationMode(option).turn(context)
    expect(turn.permission(permission({ command: ["ls"] }))).toEqual({
      gate: false,
    })

    const verdict = turn.permission(permission({ plan: PLAN }, "plan-1"))
    expect(verdict.gate).toBe(true)
    if (!verdict.gate) return
    expect(verdict.request.toolCall).toMatchObject({
      toolCallId: "run-1:plan-1",
      title: "Review plan",
      rawInput: { plan: PLAN },
    })
  })

  it("holds the duplicate plan reply and lets the gate show it", () => {
    const turn = collaborationMode(option).turn(context)
    expect(texts(turn.update(reply("m1", "Looking around.")))).toEqual([])
    expect(texts(turn.update(toolCall("read-1")))).toEqual(["Looking around."])
    expect(turn.update(reply("m2", PLAN))).toEqual([])
    const usage: SessionUpdate = {
      sessionUpdate: "usage_update",
      used: 1,
      size: 2,
    }
    expect(turn.update(usage)).toEqual([usage])

    const verdict = turn.permission(permission({ plan: PLAN }))
    expect(verdict.gate && verdict.updates).toEqual([])
  })

  it("sends a held reply that isn't the plan before the gate", () => {
    const turn = collaborationMode(option).turn(context)
    turn.update(reply("m1", "One question first."))
    const verdict = turn.permission(permission({ plan: PLAN }))
    expect(verdict.gate && texts(verdict.updates)).toEqual([
      "One question first.",
    ])
  })

  it("releases a held reply at turn end", () => {
    const turn = collaborationMode(option).turn(context)
    turn.update(reply("m1", "Which page?"))
    expect(turn.end(true)).toMatchObject({ gate: null })
    turn.update(reply("m2", "Still here."))
    expect(texts(turn.end(true).updates)).toEqual(["Still here."])
  })

  it("sets the option back to its default on a non-plan turn", async () => {
    const controls = recordingControls()
    await collaborationMode(option).open(false, controls)
    expect(controls.calls).toEqual(["collaboration_mode=default"])
  })
})

describe("reply as plan", () => {
  const option = {
    configId: "mode",
    currentValue: "build",
    defaultValue: "build",
  }

  it("allows every permission request, rawInput.plan included", () => {
    const turn = replyAsPlan(option).turn(context)
    expect(turn.permission(permission({ plan: "not a plan" }))).toEqual({
      gate: false,
    })
  })

  it("raises the last reply as the gate at end_turn, without showing it", () => {
    const turn = replyAsPlan(option).turn(context)
    expect(texts(turn.update(reply("m1", "Let me look.")))).toEqual([])
    expect(texts(turn.update(toolCall("read-1")))).toEqual(["Let me look."])
    turn.update(reply("m2", "## Plan\n\n1. Edit "))
    turn.update(reply("m2", "the button\n2. Run the tests\n"))

    const end = turn.end(true)
    expect(end.updates).toEqual([])
    expect(end.gate?.toolCall).toMatchObject({
      toolCallId: "run-1:plan",
      title: "Review plan",
      rawInput: { plan: PLAN },
    })
  })

  it("releases the reply and raises no gate on abort", () => {
    const turn = replyAsPlan(option).turn(context)
    turn.update(reply("m1", "Half a pl"))
    const end = turn.end(false)
    expect(end.gate).toBeNull()
    expect(texts(end.updates)).toEqual(["Half a pl"])
  })

  it("raises no gate when the turn ends on a tool call", () => {
    const turn = replyAsPlan(option).turn(context)
    turn.update(reply("m1", "Reading."))
    turn.update(toolCall("read-1"))
    expect(turn.end(true)).toEqual({ updates: [], gate: null })
  })

  it("passes a build turn's replies straight through", () => {
    const turn = replyAsPlan(option).turn({ ...context, planTurn: false })
    expect(texts(turn.update(reply("m1", "Done.")))).toEqual(["Done."])
    expect(turn.end(true).gate).toBeNull()
  })

  it("switches to the plan agent on a plan turn", async () => {
    const controls = recordingControls()
    await replyAsPlan(option).open(true, controls)
    expect(controls.calls).toEqual(["mode=plan"])
  })
})
