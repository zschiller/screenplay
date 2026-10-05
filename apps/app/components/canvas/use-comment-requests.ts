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
 * them queued, working and addressed. A thread on a Document goes to the chat
 * that made the Document, else to the Workspace chat the panel shows (#1314).
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
  documentChat,
  documentTitle,
  agents,
  sendComments,
}: {
  threads: readonly ThreadWithComments[]
  /** The Workspace a frame shows. */
  frameWorkspace: (frameId: string) => string | null | undefined
  /**
   * The chat a Document's threads go to (#1314): the one that made it, else
   * the Workspace chat the panel shows. Null when neither is there.
   */
  documentChat: (
    documentId: string
  ) => { branchId: string; chatId?: string } | null
  /** A Document's title, which the request names. */
  documentTitle: (documentId: string) => string | undefined
  agents: readonly BranchData[]
  /** Hands one request to a Workspace's agent, in its one chat (see
   *  `useBranchActions`). */
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

  const documentWorkspace = useCallback(
    (documentId: string) => documentChat(documentId)?.branchId,
    [documentChat]
  )

  const canSend = useCallback(
    (thread: ThreadWithComments) =>
      planAgentRequests([thread], frameWorkspace, agentReady, documentWorkspace)
        .size > 0,
    [frameWorkspace, agentReady, documentWorkspace]
  )

  const send = useCallback(
    (threadIds: readonly string[]) => {
      const ids = new Set(threadIds)
      const numbers = threadNumbers(threads)
      const requests = planAgentRequests(
        threads.filter((t) => ids.has(t.id)),
        frameWorkspace,
        agentReady,
        documentWorkspace
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
            document: t.documentId
              ? {
                  id: t.documentId,
                  title: documentTitle(t.documentId) ?? "",
                }
              : null,
            quotedText: t.quotedText,
          }))
        )
        // A Document's threads go to the Workspace of the chat that last changed it,
        // or the one the panel shows, and land in that Workspace's one chat.
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
            ? "Couldn’t send to the agent"
            : `Sent ${sent} of ${ids.size} to the agent`,
          {
            description:
              "A comment needs its chat’s code running, and can’t be sent again while the agent is on it.",
          }
        )
      }
      return sent
    },
    [
      threads,
      frameWorkspace,
      agentReady,
      documentWorkspace,
      documentTitle,
      sendComments,
    ]
  )

  return useMemo(() => ({ canSend, send }), [canSend, send])
}
