import { useCallback, useMemo } from "react"
import { toast } from "sonner"

import { formatAgentRequest, planAgentRequests } from "@/lib/comments-agent"
import type { ThreadWithComments } from "@/lib/comments"
import { threadNumbers } from "@/lib/comments-panel"
import type { BranchData } from "@/lib/types"

/**
 * Sending comment threads to their Workspace's agent (#788), for the comments
 * panel's "Send N to agent" and a thread card's "Send to agent". Both take the
 * same path: the chosen threads split into one request per Workspace, each
 * sent as one chat turn that names its threads, so the agent route can mark
 * them queued, working and addressed.
 */
export interface CommentRequests {
  /** Whether the thread can be sent now: open, on a Workspace whose agent is
   *  running, and not already with it. */
  canSend: (thread: ThreadWithComments) => boolean
  /** Send the threads; returns how many went. */
  send: (threadIds: readonly string[]) => number
}

export function useCommentRequests({
  threads,
  frameWorkspace,
  agents,
  sendComments,
}: {
  threads: readonly ThreadWithComments[]
  /** The Workspace a frame shows. */
  frameWorkspace: (frameId: string) => string | null | undefined
  agents: readonly BranchData[]
  /** Hands one request to a Workspace's agent (see `useBranchActions`). */
  sendComments: (
    agentId: string,
    message: string,
    threadIds: string[]
  ) => boolean
}): CommentRequests {
  const agentReady = useCallback(
    (workspaceId: string) => {
      const agent = agents.find((a) => a.id === workspaceId)
      return !!agent?.sandboxName && !!agent.ref
    },
    [agents]
  )

  const canSend = useCallback(
    (thread: ThreadWithComments) =>
      planAgentRequests([thread], frameWorkspace, agentReady).size > 0,
    [frameWorkspace, agentReady]
  )

  const send = useCallback(
    (threadIds: readonly string[]) => {
      const ids = new Set(threadIds)
      const numbers = threadNumbers(threads)
      const requests = planAgentRequests(
        threads.filter((t) => ids.has(t.id)),
        frameWorkspace,
        agentReady
      )
      let sent = 0
      for (const [workspaceId, list] of requests) {
        const message = formatAgentRequest(
          list.map((t) => ({
            number: numbers.get(t.id) ?? 0,
            route: t.route,
            selector: t.selector,
            anchor: t.anchor,
            snapshot: t.snapshot,
            comments: t.comments,
          }))
        )
        const ok = sendComments(
          workspaceId,
          message,
          list.map((t) => t.id)
        )
        if (ok) sent += list.length
      }
      if (sent < ids.size) {
        toast.error(
          sent === 0
            ? "Couldn't send to the agent"
            : `Sent ${sent} of ${ids.size} to the agent`,
          {
            description:
              "A comment needs a running Workspace, and can't be sent again while the agent is on it.",
          }
        )
      }
      return sent
    },
    [threads, frameWorkspace, agentReady, sendComments]
  )

  return useMemo(() => ({ canSend, send }), [canSend, send])
}
