import "server-only"

import type { ModelMessage, Tool } from "ai"
import {
  buildAgentSystemPrompt,
  buildMarkdownLayerSystemPrompt,
  type LayerDirectory,
} from "./config"
import { toolsetFor } from "./toolset"
import { prependTurnMarkers } from "./message-markers"
import type { ToolContext } from "./tools"
import { getMergedSkillIndexForSandbox } from "@/lib/skills/sandbox-index"
import type { OriginTaggedSkill } from "@/lib/skills/merged"
import { readRoomDoc } from "@/lib/yjs/server"
import {
  documentFragment,
  fragmentBodyToPlainText,
} from "@/lib/yjs/fragment-text"

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
 * Every chat target's toolset includes the cross-cutting `read_document`
 * tool (via `buildLayerReadTools`) so the model can follow `@<title>`
 * mentions to peer layers, regardless of which kind is being targeted.
 * The targeted layer's *write* tools stay private to that target's own
 * factory.
 *
 * `/api/agent/stream` looks up the right entry by `target.kind` and runs
 * the same `runAgentLoop` against whatever toolset the entry returns.
 */
export interface ChatTargetSpec<TTarget, TContext> {
  kind: string
  loadContext(roomId: string, target: TTarget): Promise<TContext | null>
  buildSystemPrompt(ctx: TContext, opts: { repoSystemPrompt?: string }): string
  buildTools(
    roomId: string,
    target: TTarget,
    sandbox?: ToolContext
  ): Record<string, Tool>
  decorateUserMessage?(
    message: string,
    opts: { planMode?: boolean; branch?: string; isFirstMessage: boolean }
  ): string
}

/**
 * Snapshot the canvas's docs for the model's directory block. Cheap — the
 * collection is already in memory; we copy id + title only.
 */
export async function loadLayerDirectory(
  roomId: string
): Promise<LayerDirectory> {
  return (
    (await readRoomDoc(roomId, ({ markdownLayers }) => ({
      documents: markdownLayers
        .toArray()
        .map((d) => ({ id: d.id, title: d.title })),
    })).catch(() => null)) ?? { documents: [] }
  )
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
  repoSystemPrompt: string | undefined
  layerDirectory: LayerDirectory
  /** Merged App ∪ Repo Skill index, enumerated once from this Branch's sandbox. */
  skills: OriginTaggedSkill[]
}

export const agentChatTarget: ChatTargetSpec<AgentTarget, AgentContext> = {
  kind: "agent",
  async loadContext(roomId, target) {
    const [repoSystemPrompt, layerDirectory, skills] = await Promise.all([
      readRoomDoc(roomId, ({ branches, repos }) => {
        const branch = branches
          .toArray()
          .find((a) => a.sandboxName === target.sandboxName)
        if (!branch) return undefined
        return repos.get(branch.repoId)?.systemPrompt
      }).catch(() => undefined),
      loadLayerDirectory(roomId),
      getMergedSkillIndexForSandbox(target.sandboxName),
    ])
    return { repoSystemPrompt, layerDirectory, skills }
  },
  buildSystemPrompt(ctx) {
    return buildAgentSystemPrompt({
      repoSystemPrompt: ctx.repoSystemPrompt ?? undefined,
      layerDirectory: ctx.layerDirectory,
      skills: ctx.skills,
    })
  },
  buildTools(roomId, _target, sandbox) {
    if (!sandbox) {
      throw new Error("agent chat target requires a sandbox ToolContext")
    }
    return toolsetFor({ kind: "sandbox", roomId, sandbox })
  },
  decorateUserMessage(message, { planMode, branch, isFirstMessage }) {
    // Policy lives here (branch only on the first message); the codec owns
    // the format.
    return prependTurnMarkers(message, {
      planMode,
      branch: isFirstMessage ? branch : undefined,
    })
  },
}

// ---------------------------------------------------------------------------
// Document target — edits a document layer's title + body via Yjs writes.
// ---------------------------------------------------------------------------

export interface MarkdownLayerTarget {
  markdownLayerId: string
}

interface MarkdownLayerContext {
  id: string
  title: string
  body: string
  layerDirectory: LayerDirectory
}

export const markdownLayerChatTarget: ChatTargetSpec<
  MarkdownLayerTarget,
  MarkdownLayerContext
> = {
  kind: "markdown-layer",
  async loadContext(roomId, target) {
    const [self, layerDirectory] = await Promise.all([
      readRoomDoc(roomId, ({ markdownLayers, doc }) => {
        const layer = markdownLayers.get(target.markdownLayerId)
        if (!layer) return null
        const fragment = documentFragment(doc, target.markdownLayerId)
        return {
          id: target.markdownLayerId,
          title: layer.title,
          body: fragmentBodyToPlainText(fragment),
        }
      }),
      loadLayerDirectory(roomId),
    ])
    if (!self) return null
    return { ...self, layerDirectory }
  },
  buildSystemPrompt(ctx) {
    return buildMarkdownLayerSystemPrompt({
      currentTitle: ctx.title,
      currentBody: ctx.body,
      layerDirectory: ctx.layerDirectory,
      selfId: ctx.id,
    })
  },
  buildTools(roomId, target) {
    return toolsetFor({
      kind: "markdown-layer",
      roomId,
      markdownLayerId: target.markdownLayerId,
    })
  },
  decorateUserMessage(message, { planMode }) {
    return prependTurnMarkers(message, { planMode })
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
  kind: string
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
    opts: { planMode?: boolean; branch?: string; isFirstMessage: boolean }
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
  toolCtx?: ToolContext
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
