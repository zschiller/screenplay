import "server-only"

import type { ModelMessage, Tool } from "ai"
import { buildAgentSystemPrompt, buildMarkdownLayerSystemPrompt } from "./config"
import { buildAgentTools } from "./tools"
import { buildMarkdownLayerTools } from "./markdown-layer-tools"
import type { ToolContext } from "./tool-executor"
import { readRoomDoc } from "@/lib/yjs/server"
import { fragmentBodyToPlainText } from "@/lib/yjs/fragment-text"

/**
 * Server-side registry of chat target kinds. Each entry contains the
 * code paths that change between targets:
 *
 *   - `loadContext` reads the live state of the target from Yjs.
 *   - `buildSystemPrompt` turns that state into a system prompt.
 *   - `buildTools` returns the AI-SDK tool object the agent loop runs with.
 *   - `decoratePrompt` lets the kind pre-process the user message (e.g.
 *     prepend a `[plan mode: enabled]` flag for sandbox chats).
 *
 * `/api/agent/stream` looks up the right entry by `target.kind` and runs
 * the same `runAgentLoop` against whatever toolset the entry returns.
 * Adding a future chat-targetable kind (sticky note, embed, …) is a
 * matter of registering one more entry here — the route doesn't need a
 * new branch.
 */
export interface ChatTargetSpec<TTarget, TContext> {
  kind: string
  loadContext(roomId: string, target: TTarget): Promise<TContext | null>
  buildSystemPrompt(ctx: TContext, opts: { workspaceSystemPrompt?: string }): string
  buildTools(roomId: string, target: TTarget, sandbox?: ToolContext): Record<string, Tool>
  decorateUserMessage?(message: string, opts: { planMode?: boolean; branch?: string; isFirstMessage: boolean }): string
}

// ---------------------------------------------------------------------------
// Agent (sandbox-backed) target — existing flow.
// ---------------------------------------------------------------------------

export interface AgentTarget {
  sandboxName: string
  branch: string
  agentId?: string
}

interface AgentContext {
  workspaceSystemPrompt: string | undefined
}

export const agentChatTarget: ChatTargetSpec<AgentTarget, AgentContext> = {
  kind: "agent",
  async loadContext(roomId, target) {
    const workspaceSystemPrompt = await readRoomDoc(roomId, ({ agents, workspaces }) => {
      const agent = agents.toArray().find((a) => a.sandboxName === target.sandboxName)
      if (!agent) return undefined
      return workspaces.get(agent.workspaceId)?.systemPrompt
    }).catch(() => undefined)
    return { workspaceSystemPrompt }
  },
  buildSystemPrompt(ctx) {
    return buildAgentSystemPrompt(ctx.workspaceSystemPrompt ?? undefined)
  },
  buildTools(_roomId, _target, sandbox) {
    if (!sandbox) {
      throw new Error("agent chat target requires a sandbox ToolContext")
    }
    return buildAgentTools(sandbox)
  },
  decorateUserMessage(message, { planMode, branch, isFirstMessage }) {
    const planPrefix = planMode ? "[plan mode: enabled] " : ""
    const branchPrefix = isFirstMessage && branch ? `[branch: ${branch}] ` : ""
    return `${planPrefix}${branchPrefix}${message}`
  },
}

// ---------------------------------------------------------------------------
// Document target — edits a document layer's title + body via Yjs writes.
// ---------------------------------------------------------------------------

export interface MarkdownLayerTarget {
  markdownLayerId: string
}

interface MarkdownLayerContext {
  title: string
  body: string
  peers: Array<{ id: string; title: string }>
}

export const markdownLayerChatTarget: ChatTargetSpec<MarkdownLayerTarget, MarkdownLayerContext> = {
  kind: "markdown-layer",
  async loadContext(roomId, target) {
    return await readRoomDoc(roomId, ({ markdownLayers, doc }) => {
      const layer = markdownLayers.get(target.markdownLayerId)
      if (!layer) return null
      const fragment = doc.getXmlFragment(`markdown-layer-${target.markdownLayerId}`)
      const peers = markdownLayers
        .toArray()
        .filter((d) => d.id !== target.markdownLayerId)
        .map((d) => ({ id: d.id, title: d.title }))
      return {
        title: layer.title,
        body: fragmentBodyToPlainText(fragment),
        peers,
      }
    })
  },
  buildSystemPrompt(ctx) {
    return buildMarkdownLayerSystemPrompt({
      currentTitle: ctx.title,
      currentBody: ctx.body,
      peers: ctx.peers,
    })
  },
  buildTools(roomId, target) {
    return buildMarkdownLayerTools({ roomId, markdownLayerId: target.markdownLayerId })
  },
  decorateUserMessage(message, { planMode }) {
    return planMode ? `[plan mode: enabled] ${message}` : message
  },
}

// ---------------------------------------------------------------------------
// Registry + lookup.
// ---------------------------------------------------------------------------

const REGISTRY: ReadonlyArray<ChatTargetSpec<never, never>> = [
  agentChatTarget as unknown as ChatTargetSpec<never, never>,
  markdownLayerChatTarget as unknown as ChatTargetSpec<never, never>,
]

const REGISTRY_BY_KIND = new Map(REGISTRY.map((s) => [s.kind, s]))

/** Returns the registered spec for a target kind, or `undefined`. */
export function getChatTargetSpec(
  kind: string,
): ChatTargetSpec<never, never> | undefined {
  return REGISTRY_BY_KIND.get(kind)
}

/** A loaded chat target — produced by `prepareChatTarget` for the route. */
export type PreparedChatTarget = {
  kind: string
  systemPrompt: string
  tools: Record<string, Tool>
  decorateUserMessage: (
    message: string,
    opts: { planMode?: boolean; branch?: string; isFirstMessage: boolean },
  ) => string
}

/**
 * One-shot helper: pick the spec, load its context, build prompt + tools.
 * Returns `null` when the target can't be resolved (e.g. document was
 * deleted) so the caller can return a 404 cleanly.
 */
export async function prepareChatTarget<TTarget, TContext>(
  roomId: string,
  spec: ChatTargetSpec<TTarget, TContext>,
  target: TTarget,
  toolCtx?: ToolContext,
): Promise<PreparedChatTarget | null> {
  const ctx = await spec.loadContext(roomId, target)
  if (!ctx) return null
  return {
    kind: spec.kind,
    systemPrompt: spec.buildSystemPrompt(ctx, {}),
    tools: spec.buildTools(roomId, target, toolCtx),
    decorateUserMessage: (message, opts) =>
      spec.decorateUserMessage?.(message, opts) ?? message,
  }
}

// Re-export used types so the route doesn't need to import them from the
// AI SDK directly.
export type { ModelMessage }
