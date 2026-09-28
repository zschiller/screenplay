/**
 * Sending comments to a Workspace's agent (#788): the request the agent gets,
 * and how its reply splits back into one reply per thread. React-free and
 * database-free so both the canvas and the agent route can use it.
 */

import type { AcpMessageRecord } from "@/lib/agent/acp/record"
import type { ElementAnchor } from "@/lib/comment-anchor"
import { selectorLabel } from "@/lib/comment-element-label"

/**
 * Where a thread sent to the agent stands: `queued` once the request is
 * accepted, `working` while the agent's turn runs, `addressed` when it has
 * finished and replied. A thread that was never sent, or whose turn failed or
 * was stopped, has none.
 */
export type AgentStatus = "queued" | "working" | "addressed"

/** The thread fields the request is written from. */
export interface AgentRequestThread {
  /** The thread's pin number, which the agent's reply refers back to. */
  number: number
  route: string | null
  selector: string | null
  anchor: ElementAnchor | null
  snapshot: string | null
  comments: readonly { authorName: string; body: string }[]
}

/** The element a comment is on, as the agent should look for it. */
export function describeElement(thread: AgentRequestThread): string | null {
  const a = thread.anchor
  if (a?.testId) return `${a.tag ?? ""}[data-testid="${a.testId}"]`
  if (a?.id) return `${a.tag ?? ""}#${a.id}`
  return selectorLabel(thread.selector) ?? a?.path ?? null
}

/**
 * The one message that asks the agent to address several comments: each
 * comment's number, route, element and conversation, then how to reply so
 * each thread gets its own answer (see {@link splitAgentReply}).
 */
export function formatAgentRequest(
  threads: readonly AgentRequestThread[]
): string {
  const one = threads.length === 1
  const lines = [
    one
      ? "Please address this comment on the app."
      : `Please address these ${threads.length} comments on the app.`,
  ]
  for (const thread of threads) {
    const element = describeElement(thread)
    const where = [thread.route, element].filter(Boolean).join(", ")
    const snapshot = thread.snapshot?.trim()
    lines.push(
      "",
      `#${thread.number}${where ? ` on ${where}` : ""}` +
        (snapshot ? ` ("${snapshot}")` : "") +
        ":"
    )
    for (const c of thread.comments) lines.push(`${c.authorName}: ${c.body}`)
  }
  const example = threads[0]?.number ?? 1
  lines.push(
    "",
    "Commit your changes. When you're done, end your reply with one line " +
      `per comment saying what you did, starting with its number, like ` +
      `"#${example}: Made the summary sticky below 768px."`
  )
  return lines.join("\n")
}

const REPLY_LINE =
  /^\s*(?:[-*]\s+)?(?:\*\*)?#(\d+)(?:\*\*)?\s*[:.)–—-]\s*(.+?)\s*$/

/**
 * Splits the agent's final message into a reply for each thread number: the
 * `#N: …` line it was asked to end with, or, for a thread it gave no line,
 * the whole message.
 */
export function splitAgentReply(
  reply: string,
  numbers: readonly number[]
): Map<number, string> {
  const found = new Map<number, string>()
  for (const line of reply.split("\n")) {
    const m = REPLY_LINE.exec(line)
    if (m) found.set(Number(m[1]), m[2]!)
  }
  const whole = reply.trim()
  return new Map(numbers.map((n) => [n, found.get(n) ?? whole]))
}

/**
 * The agent's last message in a chat's latest turn: what it says it did, and
 * so what its replies are cut from. Empty when the turn ended without one.
 */
export function lastAgentMessage(history: readonly AcpMessageRecord[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const record = history[i]!
    if (record.role === "user") return ""
    if (record.role !== "agent") continue
    const text = record.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim()
    if (text) return text
  }
  return ""
}

/** The short form of a commit hash shown on an addressed thread. */
export function shortCommit(sha: string): string {
  return sha.slice(0, 7)
}

/** The thread fields that decide whether and where a thread can be sent. */
export interface SendableThread {
  id: string
  resolved: boolean
  documentId: string | null
  iframeLayerId: string | null
  workspaceId: string | null
  agentStatus: AgentStatus | null
}

/**
 * The Workspace whose agent a thread goes to: the one it was made on, else
 * the one its frame shows. Document and canvas threads have none.
 */
export function threadWorkspace(
  thread: SendableThread,
  frameWorkspace: (frameId: string) => string | null | undefined
): string | null {
  if (thread.documentId) return null
  if (thread.workspaceId) return thread.workspaceId
  return thread.iframeLayerId
    ? (frameWorkspace(thread.iframeLayerId) ?? null)
    : null
}

/** Whether a request for the thread is already waiting on the agent. */
export function isWithAgent(thread: Pick<SendableThread, "agentStatus">) {
  return thread.agentStatus === "queued" || thread.agentStatus === "working"
}

/**
 * The requests sending `threads` makes: one per Workspace, its threads in
 * the order given. Threads that can't be sent (resolved, already with the
 * agent, or on no Workspace whose agent is running) are left out.
 */
export function planAgentRequests<T extends SendableThread>(
  threads: readonly T[],
  frameWorkspace: (frameId: string) => string | null | undefined,
  agentReady: (workspaceId: string) => boolean
): Map<string, T[]> {
  const requests = new Map<string, T[]>()
  for (const thread of threads) {
    if (thread.resolved || isWithAgent(thread)) continue
    const workspace = threadWorkspace(thread, frameWorkspace)
    if (!workspace || !agentReady(workspace)) continue
    const list = requests.get(workspace)
    if (list) list.push(thread)
    else requests.set(workspace, [thread])
  }
  return requests
}
