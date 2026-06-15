import type { ChatPanelTarget } from "@/components/agent/chat-panel"
import type {
  BranchData,
  ChatSessionData,
  MarkdownLayerData,
} from "@/lib/types"

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
 * 1. {@link resolveChatPanelTarget} — pack the selected agent or document into
 *    the `ChatPanelTarget` the chat panel renders.
 * 2. {@link restoreAgentChatSelection} — the remembered-chat rule: keep the
 *    remembered chat if it is still open, else fall back to the first open one.
 * 3. {@link pendingProbes} / {@link resolvePendingReady} — the pending-agent
 *    readiness flow: which sandboxes to probe, and what selection results when
 *    one becomes ready.
 */

/**
 * Resolve the panel's current target from the live selection. An agent wins when
 * one is selected *and* its Sandbox exists (a still-provisioning agent has no
 * `sandboxName`, so the panel would otherwise show an empty chat); otherwise the
 * picked document target; otherwise none. Agent takes precedence over document —
 * pointing the panel at an agent is what clears the doc target at the call site.
 */
export function resolveChatPanelTarget(
  selectedAgent: BranchData | undefined,
  selectedDocLayer: MarkdownLayerData | null | undefined
): ChatPanelTarget | null {
  if (selectedAgent?.sandboxName) {
    return { kind: "agent", agent: selectedAgent }
  }
  if (selectedDocLayer) {
    // Layer-kind targets are packed into the generic `{ kind: "layer",
    // layerKind, layer }` shape the chat panel dispatches through its
    // layer-kinds registry. The cast widens MarkdownLayerData to the registry's
    // open `{ id } & Record<string, unknown>` layer shape.
    return {
      kind: "layer",
      layerKind: "markdown-layer",
      layer: selectedDocLayer as unknown as { id: string } & Record<
        string,
        unknown
      >,
    }
  }
  return null
}

/**
 * The remembered-chat restoration rule for an agent target: when you switch back
 * to an agent, reopen the chat you last had selected there *if it is still
 * open*, otherwise fall back to the agent's first open chat (earliest by
 * `createdAt`), otherwise nothing. Closed chats and other agents' chats never
 * win. Tested against plain chat-session snapshots.
 */
export function restoreAgentChatSelection(
  chats: readonly ChatSessionData[],
  agentId: string,
  rememberedChatId: string | null | undefined
): string | null {
  const open = chats
    .filter((c) => c.branchId === agentId && !c.closedAt)
    .sort((a, b) => a.createdAt - b.createdAt)
  if (rememberedChatId && open.some((c) => c.id === rememberedChatId)) {
    return rememberedChatId
  }
  return open[0]?.id ?? null
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
    if (agent?.sandboxName) probes.push({ agentId, sandboxName: agent.sandboxName })
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
