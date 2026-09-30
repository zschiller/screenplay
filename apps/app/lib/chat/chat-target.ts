import type { BranchData, ChatSessionData } from "@/lib/types"
import { workspaceChatId } from "@/lib/chat/workspace-chat"

/**
 * Chat-Target selection — the pure decisions behind *which* Chat Target the
 * agent panel shows (`apps/app/CONTEXT.md`, "Chat Target"). It is the sibling of
 * the Tab Pool's pure core (`lib/chat/tab-pool.ts`): the Tab Pool decides the
 * tabs *within* a target, this decides *which* target is shown and which chat is
 * restored when you switch back to it. The Chat-Target controller
 * (`useChatTarget`, PRD #569) applies these decisions — it owns the selection
 * state, the per-target memory, and the pending-agent readiness — mirroring the
 * Tab Pool's "decide purely, apply at the call site" shape. React-free,
 * Yjs-free, tested against plain values.
 *
 * Three decisions live here:
 *
 * 1. {@link resolveChatPanelTarget} — pack the selected agent into the
 *    `ChatPanelTarget` the chat panel renders.
 * 2. {@link restoreAgentChatSelection} — the remembered-chat rule: keep the
 *    remembered chat if it is still open, else fall back to the first open one.
 * 3. {@link pendingProbes} / {@link resolvePendingReady} — the pending-agent
 *    readiness flow: which sandboxes to probe, and what selection results when
 *    one becomes ready.
 */

/**
 * What one chat talks to, on the client (`apps/app/CONTEXT.md`, "Chat
 * Target"): a Branch's sandbox or the whole Room. One value, so an impossible
 * combination (a sandbox and a Room at once) can't be written. The chat store
 * maps it to the wire target in one place. A Document is no longer a target
 * (#1314): the chat that made one edits it with its own tools.
 */
export type ChatTarget =
  | {
      kind: "agent"
      /** The Branch the chat belongs to; also the Element Targeting pick key. */
      branchId: string
      sandboxName: string
    }
  | { kind: "room" }

/**
 * The chat panel can target one of two top-level kinds:
 *  - an *agent* (sandbox-backed flow): file editing, git, PR creation, logs.
 *  - the *room*: the canvas's one Coordinator chat, the panel's home when
 *    nothing else is selected (#893).
 */
export type ChatPanelTarget =
  { kind: "agent"; agent: BranchData } | { kind: "room" }

/** The {@link ChatTarget} of a chat shown in the panel for `target`. */
export function chatTargetOf(target: ChatPanelTarget): ChatTarget {
  switch (target.kind) {
    case "agent":
      return {
        kind: "agent",
        branchId: target.agent.id,
        sandboxName: target.agent.sandboxName,
      }
    case "room":
      return { kind: "room" }
  }
}

/**
 * Resolve the panel's current target from the live selection: the selected
 * agent once its Sandbox exists (a still-provisioning agent has no
 * `sandboxName`, so the panel would otherwise show an empty chat), otherwise
 * none, and the panel shows the Room.
 */
export function resolveChatPanelTarget(
  selectedAgent: BranchData | undefined
): ChatPanelTarget | null {
  if (selectedAgent?.sandboxName) {
    return { kind: "agent", agent: selectedAgent }
  }
  return null
}

/**
 * The remembered-chat restoration rule for an agent target: when you switch back
 * to an agent, reopen the chat you last had selected there *if it is still
 * open* (an earlier chat on an old canvas, say), otherwise the Workspace's one
 * chat (#1315), otherwise nothing. Closed earlier chats and other agents' chats
 * never win. Tested against plain chat-session snapshots.
 */
export function restoreAgentChatSelection(
  chats: readonly ChatSessionData[],
  agentId: string,
  rememberedChatId: string | null | undefined
): string | null {
  const own = workspaceChatId(chats, agentId)
  if (
    rememberedChatId &&
    chats.some(
      (c) =>
        c.id === rememberedChatId &&
        c.branchId === agentId &&
        (!c.closedAt || c.id === own)
    )
  ) {
    return rememberedChatId
  }
  return own ?? null
}

/** A pending agent whose Sandbox is ready to be probed for streaming logs. */
export type PendingProbe = { agentId: string; sandboxName: string }

/**
 * The pending agents worth probing right now: those with a provisioned Sandbox.
 * A just-created agent has no `sandboxName` until the provider returns, so it is
 * dropped here rather than rendering a probe that can't resolve. Filtering at
 * decision time (instead of in a cleanup effect) means an agent list that is a
 * fresh reference every render stays safe.
 */
export function pendingProbes(
  pendingAgentIds: readonly string[],
  agents: readonly Pick<BranchData, "id" | "sandboxName">[]
): PendingProbe[] {
  const probes: PendingProbe[] = []
  for (const agentId of pendingAgentIds) {
    const agent = agents.find((a) => a.id === agentId)
    if (agent?.sandboxName)
      probes.push({ agentId, sandboxName: agent.sandboxName })
  }
  return probes
}

/** The selection + pending-set transition when a pending agent becomes ready. */
export type ReadyTransition = {
  selectedAgentId: string
  pendingAgentIds: string[]
}

/**
 * Advance the readiness flow when `readyId`'s Sandbox starts streaming logs:
 * selection flips to it and it drops out of the pending set. Deferring selection
 * to this moment (rather than at create time) avoids the "switch to an empty
 * panel, then hang on 'Connecting…'" flicker.
 */
export function resolvePendingReady(
  pendingAgentIds: readonly string[],
  readyId: string
): ReadyTransition {
  return {
    selectedAgentId: readyId,
    pendingAgentIds: pendingAgentIds.filter((id) => id !== readyId),
  }
}
