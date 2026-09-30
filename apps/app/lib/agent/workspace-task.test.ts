import { describe, expect, it } from "vitest"

import type { AgentMessage } from "@/lib/agent/types"
import {
  createdWorkspacesResult,
  sentToWorkspaceResult,
  workspaceTaskMessage,
  workspaceTaskOf,
  workspaceTasksOf,
  workspaceTaskState,
} from "./workspace-task"

type ToolCall = Extract<AgentMessage, { role: "tool_call" }>

function send(partial: Partial<ToolCall> = {}): ToolCall {
  return {
    role: "tool_call",
    toolCallId: "t1",
    title: "send_to_workspace",
    status: "completed",
    rawInput: { workspace_id: "ws-1", message: "Go" },
    content: [
      {
        type: "content",
        content: { type: "text", text: sentToWorkspaceResult("Fix", "chat-9") },
      },
    ],
    ...partial,
  }
}

describe("workspaceTaskOf", () => {
  it("names the Workspace and the chat the message went to", () => {
    expect(workspaceTaskOf(send())).toEqual({
      branchId: "ws-1",
      chatId: "chat-9",
    })
  })

  it("recognises the tool behind an external harness's MCP prefix", () => {
    expect(
      workspaceTaskOf(send({ title: "mcp__screenplay__send_to_workspace" }))
    ).toMatchObject({ branchId: "ws-1" })
  })

  it("names the Workspace while the call runs", () => {
    expect(
      workspaceTaskOf(send({ status: "in_progress", content: [] }))
    ).toEqual({ branchId: "ws-1" })
  })

  it("leaves a failed send, and other tools, as tool rows", () => {
    expect(workspaceTaskOf(send({ status: "failed" }))).toBeNull()
    expect(workspaceTaskOf(send({ title: "read_canvas" }))).toBeNull()
    expect(workspaceTaskOf(send({ rawInput: {} }))).toBeNull()
  })
})

describe("workspaceTaskState", () => {
  type Input = Parameters<typeof workspaceTaskState>[0]
  const branch: NonNullable<Input["branch"]> = {
    id: "ws-1",
    title: "Fix",
    status: "running",
  }
  const base: Input = { callRunning: false, branch, chats: [], plans: [] }
  const stateOf = (input: Partial<Input>) =>
    workspaceTaskState({ ...base, ...input }).state

  it("reads the Workspace live", () => {
    expect(stateOf({ callRunning: true })).toBe("sending")
    expect(stateOf({ branch: undefined })).toBe("removed")
    expect(stateOf({ branch: { ...branch, status: "error" } })).toBe("failed")
    expect(stateOf({ branch: { ...branch, status: "creating" } })).toBe(
      "starting"
    )
    // Running, but its seed message hasn't gone yet.
    expect(
      stateOf({
        branch: {
          ...branch,
          pendingSeed: { chatId: "c", message: "m", coordinatorChatId: "r" },
        },
      })
    ).toBe("starting")
    expect(stateOf({ chats: [{ branchId: "ws-1", isStreaming: true }] })).toBe(
      "working"
    )
    expect(stateOf({ plans: [{ branchId: "ws-1", status: "pending" }] })).toBe(
      "needs-you"
    )
    expect(stateOf({ branch: { ...branch, status: "stopped" } })).toBe(
      "stopped"
    )
    expect(stateOf({})).toBe("ready")
  })

  it("reads the same as the Workspace's own state (#1318)", () => {
    // A member marked it done: Done, whatever the sandbox says.
    expect(stateOf({ branch: { ...branch, doneAt: 1 } })).toBe("done")
    expect(
      stateOf({ branch: { ...branch, status: "stopped", doneAt: 1 } })
    ).toBe("done")
    // A blocked merge needs you, as it does in the Workspaces menu.
    expect(
      stateOf({ branch: { ...branch, prState: "open", prBlocked: true } })
    ).toBe("needs-you")
    // The icon draws from the Workspace's status line.
    expect(workspaceTaskState(base).line).toEqual({
      kind: "idle",
      state: "ready",
      text: "Ready",
    })
    expect(workspaceTaskState({ ...base, callRunning: true }).line).toBeNull()
  })

  it("ignores other Workspaces and closed chats", () => {
    expect(
      stateOf({
        chats: [
          { branchId: "ws-2", isStreaming: true },
          { branchId: "ws-1", isStreaming: true, closedAt: 1 },
        ],
        plans: [{ branchId: "ws-1", status: "approved" }],
      })
    ).toBe("ready")
  })
})

describe("workspaceTaskMessage", () => {
  it("is the message sent, on one line", () => {
    expect(
      workspaceTaskMessage(
        send({
          rawInput: {
            workspace_id: "ws-1",
            message: " Pin it.\n\nThen ship. ",
          },
        })
      )
    ).toBe("Pin it. Then ship.")
  })

  it("is null without a message or for another tool", () => {
    expect(
      workspaceTaskMessage(send({ rawInput: { workspace_id: "ws-1" } }))
    ).toBeNull()
    expect(
      workspaceTaskMessage(send({ title: "create_workspaces" }))
    ).toBeNull()
  })
})

describe("workspaceTasksOf", () => {
  function created(partial: Partial<ToolCall> = {}): ToolCall {
    return {
      role: "tool_call",
      toolCallId: "plan-1",
      title: "create_workspaces",
      status: "completed",
      rawInput: { workspaces: [] },
      content: [
        {
          type: "content",
          content: {
            type: "text",
            text: createdWorkspacesResult([
              { title: "Fix", repository: "acme/web", branchId: "ws-1" },
              {
                title: "Dark",
                repository: "acme/web",
                branchId: "ws-2",
                error: "no token",
              },
              { title: "Docs", repository: "acme/docs", error: "no repo" },
            ]),
          },
        },
      ],
      ...partial,
    }
  }

  it("shows a row for each Workspace an approved plan created, failed ones too", () => {
    expect(workspaceTasksOf(created())).toEqual([
      { branchId: "ws-1", title: "Fix" },
      { branchId: "ws-2", title: "Dark" },
    ])
  })

  it("carries each created Workspace's seed message, on one line (#1318)", () => {
    const withSeeds = created({
      rawInput: {
        workspaces: [
          { title: "Dark", repository: "acme/web", prompt: "Dark mode" },
          { title: "Fix", repository: "acme/web", prompt: " Fix it.\n\nNow. " },
        ],
      },
    })
    expect(workspaceTasksOf(withSeeds)).toEqual([
      { branchId: "ws-1", title: "Fix", message: "Fix it. Now." },
      { branchId: "ws-2", title: "Dark", message: "Dark mode" },
    ])
  })

  it("shows none for a plan the user sent back", () => {
    expect(workspaceTasksOf(created({ status: "failed" }))).toEqual([])
  })

  it("shows one for a send", () => {
    expect(workspaceTasksOf(send())).toEqual([
      { branchId: "ws-1", chatId: "chat-9" },
    ])
  })
})
