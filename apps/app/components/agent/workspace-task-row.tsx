"use client"

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  CaretRightIcon,
  CircleDashedIcon,
} from "@workspace/ui/components/icons"

import { Spinner } from "@workspace/ui/components/spinner"

import { WorkspaceStateGlyph } from "@/components/workspace-mention"
import type { AgentMessage } from "@/lib/agent/types"
import { chatStore } from "@/lib/chat-store"
import {
  WORKSPACE_TASK_STATE_LABEL,
  workspaceTaskMessage,
  workspaceTaskState,
  type WorkspaceTaskRef,
  type WorkspaceTaskState,
} from "@/lib/agent/workspace-task"
import type { WorkspaceStatusLine } from "@/lib/branch/workspace-state"
import type { BranchData, ChatSessionData, PlanData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"

/**
 * The live Room state a Coordinator transcript's task rows read, and how a
 * row opens its Workspace. Provided by the Coordinator panel only: any other
 * chat renders the same tool call as a plain tool row.
 */
export interface WorkspaceTasks {
  branches: readonly BranchData[]
  chatSessions: readonly ChatSessionData[]
  plans: readonly PlanData[]
  onOpen: (task: WorkspaceTaskRef) => void
}

const WorkspaceTasksContext = createContext<WorkspaceTasks | null>(null)

export function WorkspaceTasksProvider({
  value,
  children,
}: {
  value: WorkspaceTasks
  children: ReactNode
}) {
  return (
    <WorkspaceTasksContext.Provider value={value}>
      {children}
    </WorkspaceTasksContext.Provider>
  )
}

export function useWorkspaceTasks(): WorkspaceTasks | null {
  return useContext(WorkspaceTasksContext)
}

/**
 * The card's leading icon: the Workspace's own state glyph, as its row in the
 * Workspaces menu draws it, or a spinner while the call runs and a dashed
 * circle once the Workspace is gone.
 */
function StateIcon({
  state,
  line,
}: {
  state: WorkspaceTaskState
  line: WorkspaceStatusLine | null
}) {
  if (line) return <WorkspaceStateGlyph line={line} />
  return (
    <span className="flex size-4 shrink-0 items-center justify-center">
      {state === "sending" ? (
        <Spinner aria-hidden className="size-3.5 opacity-70" />
      ) : (
        <CircleDashedIcon
          weight="bold"
          aria-hidden
          className="size-3 opacity-50"
        />
      )}
    </span>
  )
}

/**
 * A chat the Coordinator started or messaged, as a quiet card in its
 * transcript (#896, #1150, #1318): the Workspace's state icon, its title,
 * changed lines, the state in a word and a caret, then the message it was
 * sent (or started on) on a second line. It reads the Workspace's live Branch
 * and chat state, so it updates in place as the chat works. Clicking it
 * switches the panel to that chat; the header's Coordinator crumb comes back.
 */
export function WorkspaceTaskRow({
  call,
  task,
  tasks,
}: {
  call: AgentMessage & { role: "tool_call" }
  task: WorkspaceTaskRef
  tasks: WorkspaceTasks
}) {
  const branch = tasks.branches.find((b) => b.id === task.branchId)
  // The chat the message went to streams in this client's store the moment
  // its turn starts, before any client mirrors it into the Room's records.
  const chatStreaming = useSyncExternalStore(
    (cb) => (task.chatId ? chatStore.subscribe(task.chatId, cb) : () => {}),
    () =>
      task.chatId ? chatStore.getSnapshot(task.chatId).isStreaming : false,
    () => false
  )
  const { state, line } = workspaceTaskState({
    callRunning: call.status === "pending" || call.status === "in_progress",
    branch,
    chats: chatStreaming
      ? [...tasks.chatSessions, { branchId: task.branchId, isStreaming: true }]
      : tasks.chatSessions,
    plans: tasks.plans,
  })
  const added = branch?.diffAdditions ?? 0
  const removed = branch?.diffDeletions ?? 0
  const hasDiff = branch?.status === "running" && (added > 0 || removed > 0)
  const label = WORKSPACE_TASK_STATE_LABEL[state]

  const message = task.message ?? workspaceTaskMessage(call)

  return (
    <button
      type="button"
      data-testid="workspace-task"
      data-state={state}
      disabled={!branch}
      onClick={() => tasks.onOpen(task)}
      className="flex w-full min-w-0 flex-col gap-0.5 rounded-lg bg-muted px-2.5 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 disabled:hover:bg-muted dark:bg-input/70 dark:hover:bg-input dark:disabled:hover:bg-input/70"
    >
      <span className="flex w-full min-w-0 items-center gap-2">
        <StateIcon state={state} line={line} />
        <span className="min-w-0 flex-1 truncate text-sm">
          {!branch
            ? "Removed Workspace"
            : !branch.title && task.title
              ? task.title
              : workspaceLabel(branch)}
        </span>
        {hasDiff && (
          <span className="flex shrink-0 items-center gap-1 font-mono text-xs">
            <span className="text-success">+{added}</span>
            <span className="text-destructive">-{removed}</span>
          </span>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
        {branch && (
          <CaretRightIcon
            aria-hidden
            className="size-3 shrink-0 text-muted-foreground"
          />
        )}
      </span>
      {message && (
        <span className="block w-full truncate pl-6 text-xs text-muted-foreground">
          {message}
        </span>
      )}
    </button>
  )
}
