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

/** The Coordinator tool that creates Workspaces after plan review (#898). */
export const CREATE_WORKSPACES_TOOL = "create_workspaces"

/** One Workspace of an approved `create_workspaces` plan, as it turned out. */
export interface WorkspaceCreateOutcome {
  title: string
  repository: string
  /** Set once its Branch exists, even if it then failed to start. */
  branchId?: string
  /** Why it didn't start. */
  error?: string
}

/**
 * The result `create_workspaces` records once its plan is approved. Each
 * Workspace that exists carries `[workspace <id>]`, which is how its task row
 * finds it; one that failed says why and that its row offers Retry.
 */
export function createdWorkspacesResult(
  outcomes: readonly WorkspaceCreateOutcome[]
): string {
  const started = outcomes.filter((o) => o.branchId && !o.error)
  const lines = [
    `Started ${started.length} of ${outcomes.length} Workspace${outcomes.length === 1 ? "" : "s"}. Each gets its seed message once its sandbox is running; you'll hear back when its turns end.`,
  ]
  for (const o of outcomes) {
    const name = `"${o.title}" (${o.repository})`
    const ref = o.branchId ? ` [workspace ${o.branchId}]` : ""
    if (!o.error) lines.push(`- ${name}${ref}: starting`)
    else if (o.branchId) {
      lines.push(
        `- ${name}${ref}: failed to start (${o.error}). Its row offers Retry; tell the user.`
      )
    } else
      lines.push(`- ${name}: not created, because ${o.error}. Tell the user.`)
  }
  return lines.join("\n")
}

/** One Workspace as its `create_workspaces` plan shows it. */
export interface WorkspacePlanRow {
  title: string
  /** The repository, and the base branch when it isn't the default. */
  where: string
  brief: string
}

/**
 * The plan `create_workspaces` puts in front of the user: one row per
 * Workspace, its title and repository, then its brief.
 */
export function workspacePlanMarkdown(
  rows: readonly WorkspacePlanRow[]
): string {
  const line = (text: string) => text.replace(/\s+/g, " ").trim()
  const count = rows.length
  return [
    `Create ${count} Workspace${count === 1 ? "" : "s"}:`,
    "",
    ...rows.map(
      (r) =>
        `- **${line(r.title) || "Untitled"}** · ${line(r.where)}\\\n  ${line(r.brief)}`
    ),
    "",
    "Each one starts its sandbox, and its agent begins once it's running.",
  ].join("\n")
}

/**
 * The continuation a decided `create_workspaces` plan resumes the Coordinator
 * with, as the user's turn. The server creates the Workspaces itself, so an
 * approval asks for no further action.
 */
export function workspacePlanResolutionText(resolution: {
  approved: boolean
  feedback?: string
}): string {
  return resolution.approved
    ? "Approved the plan."
    : resolution.feedback?.trim() ||
        "Requested changes to the plan. Please revise."
}

/** The result recorded when the user asks for changes to the plan instead. */
export function workspacePlanRejectedResult(feedback?: string): string {
  const said = feedback?.trim()
  return said
    ? `Not created: the user asked for changes to the plan: ${said}`
    : "Not created: the user asked for changes to the plan."
}

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

const SENT_CHAT_RE = /\[chat ([^\]\s]+)\]/

/**
 * The Workspace a tool call names, when it renders as a task row: a
 * `send_to_workspace` call (bare, or namespaced by an external harness's MCP
 * prefix) that didn't fail. A failed send stays a tool row, so its reason shows.
 */
export function workspaceTaskOf(
  call: ToolCallMessage
): WorkspaceTaskRef | null {
  if (!isTool(call.title, SEND_TO_WORKSPACE_TOOL)) return null
  if (call.status === "failed") return null
  const input = call.rawInput
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const branchId = (input as Record<string, unknown>).workspace_id
  if (typeof branchId !== "string" || !branchId) return null
  const chatId = resultText(call).match(SENT_CHAT_RE)?.[1]
  return chatId ? { branchId, chatId } : { branchId }
}

const CREATED_WORKSPACE_RE = /\[workspace ([^\]\s]+)\]/g

/**
 * The Workspaces a tool call names as task rows: one for a
 * `send_to_workspace` (see {@link workspaceTaskOf}), one per Workspace a
 * completed `create_workspaces` created. Empty for any other call, which
 * stays a tool row.
 */
export function workspaceTasksOf(call: ToolCallMessage): WorkspaceTaskRef[] {
  if (isTool(call.title, CREATE_WORKSPACES_TOOL)) {
    if (call.status !== "completed") return []
    const text = resultText(call)
    return [...text.matchAll(CREATED_WORKSPACE_RE)].map((m) => ({
      branchId: m[1]!,
    }))
  }
  const task = workspaceTaskOf(call)
  return task ? [task] : []
}

function isTool(name: string, tool: string): boolean {
  return name === tool || name.endsWith(`__${tool}`)
}

function resultText(call: ToolCallMessage): string {
  return call.content
    .map((b) =>
      b.type === "content" && b.content.type === "text" ? b.content.text : ""
    )
    .join("\n")
}

/** What a task row shows, in the words the row uses. */
export type WorkspaceTaskState =
  | "sending"
  | "starting"
  | "working"
  | "needs-you"
  | "done"
  | "failed"
  | "removed"

/**
 * A task row's state, read live from the Room: its sandbox still starting or
 * failed, its agent working (any open chat streaming), waiting on the user (a
 * plan pending approval), or done. `sending` covers the tool call itself still running.
 */
export function workspaceTaskState(input: {
  callRunning: boolean
  branch: Pick<BranchData, "id" | "status" | "pendingSeed"> | undefined
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
  // A created Workspace counts as starting until its seed message is sent.
  if (
    branch.status === "creating" ||
    branch.status === "starting" ||
    branch.pendingSeed
  ) {
    return "starting"
  }
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
  starting: "Starting",
  working: "Working",
  "needs-you": "Needs you",
  done: "Done",
  failed: "Failed",
  removed: "Removed",
}
