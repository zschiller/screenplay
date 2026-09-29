"use client"

import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  CaretRightIcon,
  CheckIcon,
  CircleDashedIcon,
  WarningCircleIcon,
} from "@workspace/ui/components/icons"

import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"

import { GripSpinner } from "@/components/grip-spinner"
import type { AgentMessage } from "@/lib/agent/types"
import { chatStore } from "@/lib/chat-store"
import {
  WORKSPACE_TASK_STATE_LABEL,
  workspaceTaskState,
  type WorkspaceTaskRef,
  type WorkspaceTaskState,
} from "@/lib/agent/workspace-task"
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

function StateIcon({ state }: { state: WorkspaceTaskState }) {
  const cls = "size-3 shrink-0"
  switch (state) {
    case "sending":
    case "starting":
      return <Spinner aria-hidden className={cls} />
    case "working":
      // The Workspace's agent at work: LLM activity, so the grid.
      return <GripSpinner className={cls} />
    case "needs-you":
      return (
        <WarningCircleIcon aria-hidden className={cn(cls, "text-warning")} />
      )
    case "failed":
      return (
        <WarningCircleIcon
          aria-hidden
          className={cn(cls, "text-destructive")}
        />
      )
    case "removed":
      return <CircleDashedIcon aria-hidden className={cls} />
    case "done":
      return <CheckIcon aria-hidden className={cn(cls, "text-success")} />
  }
}

/**
 * A Workspace the Coordinator messaged, as one row in its transcript (#896):
 * status icon, Workspace title, changed lines, the state in a word and a
 * chevron, drawn as a muted line like a finished turn's summary row. It reads
 * the Workspace's live Branch and chat state, so it updates in place as the
 * Workspace works. Clicking it opens the Workspace on the chat the message
 * went to.
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
  const state = workspaceTaskState({
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

  return (
    <button
      type="button"
      data-testid="workspace-task"
      data-state={state}
      disabled={!branch}
      onClick={() => tasks.onOpen(task)}
      className="flex max-w-full min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-1 text-left text-xs leading-5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 disabled:hover:text-muted-foreground"
    >
      <StateIcon state={state} />
      <span className="min-w-0 truncate">
        {branch ? workspaceLabel(branch) : "Removed Workspace"}
      </span>
      {hasDiff && (
        <span className="flex shrink-0 items-center gap-1 font-mono text-xs">
          <span className="text-success">+{added}</span>
          <span className="text-destructive">-{removed}</span>
        </span>
      )}
      <span aria-hidden className="shrink-0">
        ·
      </span>
      <span className="shrink-0">{label}</span>
      {branch && <CaretRightIcon aria-hidden className="size-3 shrink-0" />}
    </button>
  )
}
