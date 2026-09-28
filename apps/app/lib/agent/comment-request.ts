import "server-only"

import { eq } from "drizzle-orm"
import { loadAcpHistory } from "@/lib/agent/persistence"
import { lastAgentMessage, splitAgentReply } from "@/lib/comments-agent"
import {
  pendingAgentThreads,
  queueThreadsForAgent,
  roomThreadOrder,
  settleAgentThreads,
  startAgentThreads,
} from "@/lib/comments"
import { threadNumbers } from "@/lib/comments-panel"
import { db } from "@/lib/db"
import { agentRun } from "@/lib/db/schema"
import { runSandboxAction, step } from "@/lib/sandbox/run"

/**
 * The server half of sending comments to a Workspace's agent (#788). The
 * canvas sends the request as an ordinary chat turn naming the threads; the
 * agent route queues them here, moves them to working as the turn starts,
 * and settles them when it ends: each thread gets the agent's reply for it
 * and the commit it made.
 */

/** HEAD in the Workspace's sandbox, or null when it can't be read. */
async function readHead(sandboxName: string): Promise<string | null> {
  const result = await runSandboxAction(sandboxName, async (sandbox) => {
    const out = await step(sandbox, "git", ["rev-parse", "HEAD"])
    return (await out.stdout()).trim()
  })
  return result.success && result.value ? result.value : null
}

/** Queues the threads a request names, once its turn is accepted. */
export async function queueCommentRequest(opts: {
  roomId: string
  chatId: string
  sandboxName: string
  threadIds: readonly string[]
}): Promise<void> {
  await queueThreadsForAgent({
    roomId: opts.roomId,
    threadIds: opts.threadIds,
    chatId: opts.chatId,
    readBaseCommit: () => readHead(opts.sandboxName),
  })
}

/** Marks a chat's queued threads as being worked on. */
export async function startCommentRequest(
  roomId: string,
  chatId: string
): Promise<void> {
  await startAgentThreads(roomId, chatId)
}

/**
 * Settles a chat's pending threads after one of its turns. A completed turn
 * addresses them; a failed or stopped one clears their status. A turn paused
 * for plan approval, or superseded by a newer one, leaves them working: the
 * turn that follows settles them.
 */
export async function settleCommentRequest(opts: {
  roomId: string
  chatId: string
  runId: string
  sandboxName: string
  userId: string
}): Promise<void> {
  try {
    const pending = await pendingAgentThreads(opts.chatId)
    if (pending.length === 0) return
    const [run] = await db
      .select({ status: agentRun.status })
      .from(agentRun)
      .where(eq(agentRun.id, opts.runId))
      .limit(1)
    const status = run?.status
    if (status === "failed" || status === "aborted") {
      await settleAgentThreads({
        roomId: opts.roomId,
        chatId: opts.chatId,
        authorId: opts.userId,
        replies: new Map(),
        failed: pending.map((t) => t.id),
      })
      return
    }
    if (status !== "completed") return

    const [history, order, head] = await Promise.all([
      loadAcpHistory(opts.chatId),
      roomThreadOrder(opts.roomId),
      readHead(opts.sandboxName),
    ])
    const numbers = threadNumbers(order)
    const numberOf = (id: string) => numbers.get(id) ?? 0
    const split = splitAgentReply(
      lastAgentMessage(history),
      pending.map((t) => numberOf(t.id))
    )
    await settleAgentThreads({
      roomId: opts.roomId,
      chatId: opts.chatId,
      authorId: opts.userId,
      replies: new Map(
        pending.map((t) => [
          t.id,
          {
            body: split.get(numberOf(t.id)) ?? "",
            commit: head && head !== t.agentBaseCommit ? head : null,
          },
        ])
      ),
      failed: [],
    })
  } catch (e) {
    // The turn itself is done; a thread left working can be sent again.
    console.error("settling comment request failed:", e)
  }
}
