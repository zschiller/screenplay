import { describe, expect, it } from "vitest"
import {
  isPlanGate,
  isUpdate,
  planFromPermissionRequest,
  planPermissionRequest,
  planResolutionOutcome,
  PLAN_APPROVE_OPTION_ID,
  PLAN_REJECT_OPTION_ID,
  sessionNotificationSchema,
  type RequestPermissionRequest,
  type SessionUpdate,
} from "./schema"

/**
 * Real-adapter wire compatibility (the desktop "tool chip spins forever" bug).
 *
 * `claude-code-acp` reports a tool call's terminal `tool_call_update` with a
 * `rawOutput` that is an **array** of content blocks (verified by capturing the
 * live adapter's frames). The previously vendored
 * `@zed-industries/agent-client-protocol@0.4.5` typed `rawInput`/`rawOutput` as
 * `z.record(z.unknown())` — object-only — so the whole notification failed the
 * schema parse *inside the client* and was **silently dropped** (a
 * notification's parse error is swallowed). The `status: "completed"` never
 * reached the consumer, so the record stayed `in_progress` and the chip spun
 * forever. The durable fix migrated the vendored protocol to a generation where
 * these fields are arbitrary JSON. Re-validated under the `@agentclientprotocol/sdk`
 * `0.x → 1.x` bump (#638): `rawInput`/`rawOutput` are still `z.unknown()` in 1.x,
 * so the array-shaped `rawOutput` keeps parsing. This pins that the real adapter's
 * wire shape parses, so a future protocol regression fails here, not in chat.
 */
describe("tool_call_update wire compatibility with the real adapter", () => {
  // The exact shape captured from `claude-code-acp@0.16.2` on a file write; still
  // representative of the pinned `@agentclientprotocol/claude-agent-acp` adapter.
  const completed = {
    sessionId: "sess_1",
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "toolu_016LpnRKF3w7ywJHthbbwKL1",
      status: "completed",
      _meta: { claudeCode: { toolName: "mcp__acp__Write" } },
      rawOutput: [
        {
          type: "text",
          text: "The file /tmp/hello.txt has been updated successfully.",
        },
      ],
    },
  }

  it("accepts a terminal tool_call_update whose rawOutput is an array", () => {
    const parsed = sessionNotificationSchema.parse(completed)
    expect(isUpdate(parsed.update, "tool_call_update")).toBe(true)
    if (isUpdate(parsed.update, "tool_call_update")) {
      // The load-bearing field: the status must survive the parse so the
      // renderer can leave `in_progress` and stop the spinner.
      expect(parsed.update.status).toBe("completed")
    }
  })

  it("still accepts an object-shaped rawInput (the common case)", () => {
    const parsed = sessionNotificationSchema.parse({
      sessionId: "sess_1",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "toolu_x",
        title: "Write hello.txt",
        status: "in_progress",
        rawInput: { file_path: "hello.txt", content: "hi" },
      },
    })
    expect(parsed.update.sessionUpdate).toBe("tool_call")
  })
})

/**
 * Subagent tool-call attribution rides `_meta.claudeCode.parentToolUseId`
 * (#636 / #638). When Claude spawns a subagent (a `Task`), the adapter stamps
 * each tool call the subagent makes with the parent tool-use id — so the client
 * can nest the child's tool calls under the spawning `Task` row rather than
 * showing them flat. `_meta` is a passthrough record in the ACP schema
 * (`z.record(z.string(), z.unknown())`), so the id rides through the parse with
 * **no schema change on our side**.
 *
 * This is the load-bearing guard for the SDK `0.x → 1.x` bump (#638): a captured
 * real frame from the pinned adapter version must keep parsing with the id
 * intact. If a future SDK generation tightened `_meta` and dropped the nested
 * `claudeCode` payload, the attribution would silently vanish (subagent tool
 * calls would render flat). This test turns that regression into a failure here.
 */
describe("subagent tool-call frame carries _meta.claudeCode.parentToolUseId", () => {
  // A tool_call creation frame captured from a subagent (a `Task`) under
  // `@agentclientprotocol/claude-agent-acp@0.54.1`: the adapter merges
  // `_meta.claudeCode.parentToolUseId` onto every notification it emits for a
  // message whose `parent_tool_use_id` is set (see the adapter's
  // `toAcpNotifications` parent-id merge).
  const subagentToolCall = {
    sessionId: "sess_1",
    update: {
      sessionUpdate: "tool_call",
      toolCallId: "toolu_01ChildReadAbc",
      title: "Read config.ts",
      kind: "read",
      status: "pending",
      rawInput: { file_path: "config.ts" },
      _meta: {
        claudeCode: {
          toolName: "Read",
          parentToolUseId: "toolu_01ParentTaskXyz",
        },
      },
    },
  }

  it("parses and preserves the parent tool-use id through the schema", () => {
    const parsed = sessionNotificationSchema.parse(subagentToolCall)
    expect(isUpdate(parsed.update, "tool_call")).toBe(true)
    // The id survives the parse untouched — a passthrough `_meta`, no schema
    // change here. A future SDK that dropped it fails this assertion.
    const meta = parsed.update._meta as {
      claudeCode?: { parentToolUseId?: string }
    }
    expect(meta?.claudeCode?.parentToolUseId).toBe("toolu_01ParentTaskXyz")
  })

  it("also preserves it on a terminal tool_call_update from the subagent", () => {
    // The parent-id merge is applied to every notification, so the completing
    // `tool_call_update` carries it too (with an array-shaped rawOutput, the
    // real completed shape).
    const parsed = sessionNotificationSchema.parse({
      sessionId: "sess_1",
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "toolu_01ChildReadAbc",
        status: "completed",
        rawOutput: [{ type: "text", text: "ok" }],
        _meta: {
          claudeCode: {
            toolName: "Read",
            parentToolUseId: "toolu_01ParentTaskXyz",
          },
        },
      },
    })
    const meta = parsed.update._meta as {
      claudeCode?: { parentToolUseId?: string }
    }
    expect(meta?.claudeCode?.parentToolUseId).toBe("toolu_01ParentTaskXyz")
  })
})

describe("plan-mode gate as an ACP permission request", () => {
  const request = planPermissionRequest({
    sessionId: "chat_1",
    toolCallId: "toolu_1",
    plan: "## Plan\n1. do it",
  })

  it("carries the plan on the toolCall as an ACP content block + rawInput", () => {
    expect(request.toolCall.toolCallId).toBe("toolu_1")
    expect(request.toolCall.content).toEqual([
      { type: "content", content: { type: "text", text: "## Plan\n1. do it" } },
    ])
    expect(request.options.map((o) => o.optionId)).toEqual([
      PLAN_APPROVE_OPTION_ID,
      PLAN_REJECT_OPTION_ID,
    ])
  })

  it("recovers { toolCallId, plan } from the request", () => {
    expect(planFromPermissionRequest(request)).toEqual({
      toolCallId: "toolu_1",
      plan: "## Plan\n1. do it",
    })
  })

  it("recognises its own gate by its option ids", () => {
    expect(isPlanGate(request)).toBe(true)
    const other: RequestPermissionRequest = {
      sessionId: "s",
      toolCall: { toolCallId: "t" },
      options: [{ optionId: "yes", name: "Yes", kind: "allow_once" }],
    }
    expect(isPlanGate(other)).toBe(false)
  })

  it("is kept distinct from ACP's informational `plan` session update", () => {
    // The approval gate is a permission request; ACP's `plan` is a separate
    // `session/update` the UI may render. They must never be conflated.
    const planUpdate = {
      sessionUpdate: "plan",
      entries: [],
    } as unknown as SessionUpdate
    expect(isUpdate(planUpdate, "plan")).toBe(true)
    // The permission request is not a session update at all — no `sessionUpdate`.
    expect("sessionUpdate" in request).toBe(false)
  })

  it("maps a decision to the ACP RequestPermissionResponse outcome", () => {
    expect(planResolutionOutcome(true)).toEqual({
      outcome: "selected",
      optionId: PLAN_APPROVE_OPTION_ID,
    })
    expect(planResolutionOutcome(false)).toEqual({
      outcome: "selected",
      optionId: PLAN_REJECT_OPTION_ID,
    })
  })
})
