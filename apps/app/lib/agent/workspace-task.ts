import type { AgentMessage } from "@/lib/agent/types"
import type { BranchData, ChatSessionData, PlanData } from "@/lib/types"
import { isBranchBusy } from "@/lib/branch-busy"

/**
 * Workspace task rows (#896): how a Coordinator tool call that names a
 * Workspace is recognised in the transcript, and the live state its row shows.
 * Isomorphic, so the tool (server) writes the result the row (client) reads.
 */

type ToolCallMessage = Extract<AgentMessage, { role: "tool_call" }>

/** The Coordinator tool that sends a Delegated Message into a Workspace. */
export const SEND_TO_WORKSPACE_TOOL = "send_to_workspace"

/** The Workspace a task row stands for, and the chat the message went to. */
export interface WorkspaceTaskRef {
  branchId: string
  chatId?: string
}

/**
 * The line `send_to_workspace` returns. It names the chat in brackets so the
 * task row can open the chat the message went to.
 */
export function sentToWorkspaceResult(title: string, chatId: string): string {
  return `Sent to "${title}" [chat ${chatId}]. Its agent is working on it now; you'll hear back when its turn ends.`
}

/** The link scheme a Coordinator reply names a Workspace with (#897). */
export const WORKSPACE_LINK_SCHEME = "workspace:"

/**
 * A Markdown link to a Workspace, `[title](workspace:<id>)`. The Coordinator
 * panel draws it as a link that opens the Workspace.
 */
export function workspaceLink(title: string, workspaceId: string): string {
  return `[${title.replace(/[[\]]/g, "")}](${WORKSPACE_LINK_SCHEME}${workspaceId})`
}

const SENT_CHAT_RE = /\[chat ([^\]\s]+)\]/

/**
 * The Workspace a tool call names, when it renders as a task row: a
 * `send_to_workspace` call (bare, or namespaced by an external harness's MCP
 * prefix) that didn't fail. A failed send stays a tool row, so its reason shows.
 */
export function workspaceTaskOf(
  call: ToolCallMessage
): WorkspaceTaskRef | null {
  const name = call.title
  if (
    name !== SEND_TO_WORKSPACE_TOOL &&
    !name.endsWith(`__${SEND_TO_WORKSPACE_TOOL}`)
  ) {
    return null
  }
  if (call.status === "failed") return null
  const input = call.rawInput
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const branchId = (input as Record<string, unknown>).workspace_id
  if (typeof branchId !== "string" || !branchId) return null
  const text = call.content
    .map((b) =>
      b.type === "content" && b.content.type === "text" ? b.content.text : ""
    )
    .join("\n")
  const chatId = text.match(SENT_CHAT_RE)?.[1]
  return chatId ? { branchId, chatId } : { branchId }
}

/** What a task row shows, in the words the row uses. */
export type WorkspaceTaskState =
  | "sending"
  | "working"
  | "needs-you"
  | "done"
  | "failed"
  | "removed"

/**
 * A task row's state, read live from the Room: its agent working (any open
 * chat streaming), waiting on the user (a plan pending approval), its sandbox
 * failed, or done. `sending` covers the tool call itself still running.
 */
export function workspaceTaskState(input: {
  callRunning: boolean
  branch: Pick<BranchData, "id" | "status"> | undefined
  chats: readonly Pick<
    ChatSessionData,
    "branchId" | "closedAt" | "isStreaming"
  >[]
  plans: readonly Pick<PlanData, "branchId" | "status">[]
}): WorkspaceTaskState {
  const { branch, callRunning } = input
  if (callRunning) return "sending"
  if (!branch) return "removed"
  if (branch.status === "error") return "failed"
  if (isBranchBusy(branch.id, input.chats)) return "working"
  if (
    input.plans.some((p) => p.branchId === branch.id && p.status === "pending")
  )
    return "needs-you"
  return "done"
}

/** A task row's state as the row's trailing word. */
export const WORKSPACE_TASK_STATE_LABEL: Record<WorkspaceTaskState, string> = {
  sending: "Sending",
  working: "Working",
  "needs-you": "Needs you",
  done: "Done",
  failed: "Failed",
  removed: "Removed",
}
