import type { AgentMessage } from "@/lib/agent/types"
import type { BranchData, PlanData } from "@/lib/types"
import type { BranchBusyChat } from "@/lib/branch-busy"
import {
  roomWorkspaceFacts,
  workspaceState,
  type WorkspaceStateBranch,
  type WorkspaceStatusLine,
} from "@/lib/branch/workspace-state"

/**
 * Workspace task rows (#896): how a Coordinator tool call that names a
 * Workspace is recognised in the transcript, and the live state its row shows.
 * Isomorphic, so the tool (server) writes the result the row (client) reads.
 */

type ToolCallMessage = Extract<AgentMessage, { role: "tool_call" }>

/** The Coordinator tool that sends a Delegated Message into a Workspace. */
export const SEND_TO_WORKSPACE_TOOL = "send_to_workspace"

/** The Coordinator tool that creates Workspaces (#898). */
export const CREATE_WORKSPACES_TOOL = "create_workspaces"

/** The Coordinator tool that opens a Workspace's pull request (#901). */
export const OPEN_PULL_REQUEST_TOOL = "open_pull_request"

/** The Coordinator tool that removes a Workspace (#901). */
export const REMOVE_WORKSPACE_TOOL = "remove_workspace"

/** One Workspace a `create_workspaces` call asked for, as it turned out. */
export interface WorkspaceCreateOutcome {
  title: string
  repository: string
  /** Set once its Branch exists, even if it then failed to start. */
  branchId?: string
  /** Why it didn't start. */
  error?: string
}

/**
 * The result `create_workspaces` returns. Each
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

/** The Workspace a task row stands for, and the chat the message went to. */
export interface WorkspaceTaskRef {
  branchId: string
  chatId?: string
  /** The title a created Workspace was asked for, until its Branch has one. */
  title?: string
  /** The seed message a created Workspace started on, for its card. */
  message?: string
}

/**
 * The line `send_to_workspace` returns. It names the chat in brackets so the
 * task row can open the chat the message went to.
 */
export function sentToWorkspaceResult(title: string, chatId: string): string {
  return `Sent to "${title}" [chat ${chatId}]. Its agent is working on it now; you'll hear back when its turn ends.`
}

/**
 * The line `send_to_workspace` returns when a fresh Workspace still starting
 * holds the message until its sandbox runs (#1182). Named like
 * {@link sentToWorkspaceResult}, so its task row finds the chat the same way.
 */
export function queuedForWorkspaceResult(
  title: string,
  chatId: string
): string {
  return `Queued for "${title}" [chat ${chatId}]. Its sandbox is still starting; the message is sent as soon as it runs, and you'll hear back when its turn ends.`
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
  if (!isTool(call.title, SEND_TO_WORKSPACE_TOOL)) return null
  if (call.status === "failed") return null
  const input = call.rawInput
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const branchId = (input as Record<string, unknown>).workspace_id
  if (typeof branchId !== "string" || !branchId) return null
  const chatId = resultText(call).match(SENT_CHAT_RE)?.[1]
  return chatId ? { branchId, chatId } : { branchId }
}

/**
 * The message a `send_to_workspace` call sent, as its task row's second line
 * (#1150). Whitespace collapses, since the row shows it on one line.
 */
export function workspaceTaskMessage(call: ToolCallMessage): string | null {
  if (!isTool(call.title, SEND_TO_WORKSPACE_TOOL)) return null
  const input = call.rawInput
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  return oneLine((input as Record<string, unknown>).message)
}

const CREATED_WORKSPACE_RE = /\[workspace ([^\]\s]+)\]/
/** A result line's `"title" (owner/name)`, to find the Workspace's seed. */
const CREATED_NAME_RE = /^- "(.*)" \(([^()\s]+)\)/

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
    const asked = createdInputs(call)
    return text.split("\n").flatMap((line) => {
      const branchId = line.match(CREATED_WORKSPACE_RE)?.[1]
      if (!branchId) return []
      const name = line.match(CREATED_NAME_RE)
      const message = name
        ? oneLine(
            asked.find((w) => w.title === name[1] && w.repository === name[2])
              ?.prompt
          )
        : null
      return [
        {
          branchId,
          ...(name ? { title: name[1] } : {}),
          ...(message ? { message } : {}),
        },
      ]
    })
  }
  const task = workspaceTaskOf(call)
  return task ? [task] : []
}

/** The Workspaces a `create_workspaces` call asked for, as far as they parse. */
function createdInputs(
  call: ToolCallMessage
): { title?: unknown; repository?: unknown; prompt?: unknown }[] {
  const input = call.rawInput
  if (!input || typeof input !== "object" || Array.isArray(input)) return []
  const list = (input as Record<string, unknown>).workspaces
  if (!Array.isArray(list)) return []
  return list.filter(
    (w): w is Record<string, unknown> => !!w && typeof w === "object"
  )
}

function oneLine(text: unknown): string | null {
  if (typeof text !== "string") return null
  return text.replace(/\s+/g, " ").trim() || null
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

/**
 * What a chat card shows (#1318), in the words the card uses. Past the tool
 * call itself, it is the Workspace's own state (Workspace State, #1247), so a
 * card reads the same as the Workspace's row in the Workspaces menu.
 */
export type WorkspaceTaskState =
  | "sending"
  | "starting"
  | "working"
  | "needs-you"
  | "ready"
  | "stopped"
  | "done"
  | "failed"
  | "removed"

/** A chat card's state, and the Workspace's status line behind its icon. */
export interface WorkspaceTaskStatus {
  state: WorkspaceTaskState
  /** The Workspace's status line; null while sending or once removed. */
  line: WorkspaceStatusLine | null
}

/**
 * A chat card's state, read live from the Room: the tool call still running
 * (`sending`), the Workspace gone (`removed`), else the Workspace's own state
 * from {@link workspaceState}: Done when a member marked it done, setup
 * running or failed, its agent working, needing you (a plan to approve, a
 * question to answer or a blocked merge), stopped, or Ready once the turn ended. A created Workspace
 * counts as starting until its seed message is sent.
 */
export function workspaceTaskState(input: {
  callRunning: boolean
  branch: (WorkspaceStateBranch & Pick<BranchData, "pendingSeed">) | undefined
  chats: readonly (BranchBusyChat & { id?: string })[]
  plans: readonly Pick<PlanData, "branchId" | "status">[]
  /** Chats, by id, waiting on an answer to a question card. */
  openQuestions?: ReadonlySet<string>
}): WorkspaceTaskStatus {
  const { branch, callRunning } = input
  if (callRunning) return { state: "sending", line: null }
  if (!branch) return { state: "removed", line: null }
  const { line } = workspaceState(
    branch,
    roomWorkspaceFacts(input.chats, input.plans, input.openQuestions)
  )
  if (line.kind === "error") return { state: "failed", line }
  if (line.kind === "progress") return { state: "starting", line }
  if (line.state !== "done" && branch.pendingSeed) {
    return { state: "starting", line: { kind: "progress", step: "Starting" } }
  }
  return { state: line.state, line }
}

/** A chat card's state as the card's trailing word. */
export const WORKSPACE_TASK_STATE_LABEL: Record<WorkspaceTaskState, string> = {
  sending: "Sending",
  starting: "Starting",
  working: "Working",
  "needs-you": "Needs you",
  ready: "Ready",
  stopped: "Stopped",
  done: "Done",
  failed: "Failed",
  removed: "Removed",
}
