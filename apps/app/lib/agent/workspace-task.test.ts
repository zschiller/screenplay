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
  const branch = { id: "ws-1", status: "running" as const }
  const base = { callRunning: false, branch, chats: [], plans: [] }

  it("reads the Workspace live", () => {
    expect(workspaceTaskState({ ...base, callRunning: true })).toBe("sending")
    expect(workspaceTaskState({ ...base, branch: undefined })).toBe("removed")
    expect(
      workspaceTaskState({ ...base, branch: { ...branch, status: "error" } })
    ).toBe("failed")
    expect(
      workspaceTaskState({ ...base, branch: { ...branch, status: "creating" } })
    ).toBe("starting")
    // Running, but its seed message hasn't gone yet.
    expect(
      workspaceTaskState({
        ...base,
        branch: {
          ...branch,
          pendingSeed: { chatId: "c", message: "m", coordinatorChatId: "r" },
        },
      })
    ).toBe("starting")
    expect(
      workspaceTaskState({
        ...base,
        chats: [{ branchId: "ws-1", isStreaming: true }],
      })
    ).toBe("working")
    expect(
      workspaceTaskState({
        ...base,
        plans: [{ branchId: "ws-1", status: "pending" }],
      })
    ).toBe("needs-you")
    expect(workspaceTaskState(base)).toBe("finished")
  })

  it("ignores other Workspaces and closed chats", () => {
    expect(
      workspaceTaskState({
        ...base,
        chats: [
          { branchId: "ws-2", isStreaming: true },
          { branchId: "ws-1", isStreaming: true, closedAt: 1 },
        ],
        plans: [{ branchId: "ws-1", status: "approved" }],
      })
    ).toBe("finished")
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
      { branchId: "ws-1" },
      { branchId: "ws-2" },
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
