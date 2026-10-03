import "server-only"

import type { ToolSet } from "ai"
import { renderSkillsNote, type LayerDirectory } from "./config"
import { turnToolset, type ChatTools } from "./toolset"
import { BARE_TOOL_NAMING, type ToolNaming } from "./tool-name"
import type { RoomDoc, RoomReader } from "@/lib/room-access"
import { readMemory } from "@/lib/memory/canvas"
import {
  readAccountMemory,
  type AccountMemoryStore,
} from "@/lib/memory/account"
import { kvAccountMemoryStore } from "@/lib/memory/account-store"
import type { MemoryData } from "@/lib/types"
import type { SkillMetadata } from "@/lib/skills/frontmatter"

/**
 * The seam every chat target kind fills: a Branch's Workspace
 * (`workspace-chat-target.ts`), the whole Room's Coordinator
 * (`room-chat-target.ts`), or a Sketch Chat with no repository
 * (`sketch-chat-target.ts`). A Document is no longer a target (#1314): a
 * Workspace chat writes the Documents it owns with its own tools. Each kind's
 * module holds the code paths that change between targets:
 *
 *   - `loadContext` reads the live state of the target from Yjs.
 *   - `buildSystemPrompt` turns that state into a system prompt, naming tools
 *     only through `naming`, which knows just the turn's toolset.
 *   - `skillIndex` picks the turn's merged Skill index out of that state, for
 *     the note a resumed harness session gets in place of a new prompt.
 *   - `tools` lists the kind's tools, once (#1487): the in-process turn and
 *     the agent MCP route both take theirs from it (`toolset.ts`).
 *   - `decorateUserMessage` lets the kind pre-process the user message (e.g.
 *     prepend a `[plan mode: enabled]` flag for Workspace chats).
 *
 * Every kind's toolset includes the cross-cutting `read_document` and
 * `ask_question` tools, so the model can follow `@<title>` mentions to peer
 * layers and ask the user a Question Card, whichever kind it is.
 */
export interface ChatTargetSpec<TTarget, TContext> {
  kind: string
  loadContext(room: RoomDoc, target: TTarget): Promise<TContext | null>
  buildSystemPrompt(ctx: TContext, naming: ToolNaming): string
  skillIndex(ctx: TContext): readonly SkillMetadata[]
  tools(room: RoomDoc, target: TTarget): ChatTools
  decorateUserMessage(message: string, opts: MessageDecoration): string
}

/** What a kind's `decorateUserMessage` may mark a user message with. */
export interface MessageDecoration {
  planMode?: boolean
  branch?: string
  isFirstMessage: boolean
  /** The Coordinator chat that sent this turn, for a Delegated Message. */
  delegatedFrom?: string
}

/** A loaded chat target, produced by {@link prepareChatTarget} for a turn. */
export interface PreparedChatTarget<TContext> {
  kind: string
  context: TContext
  systemPrompt: string
  /**
   * The turn's Skill index as a note on the user turn, for an engine that
   * resumes a session holding an older prompt (#1555); "" with no Skills.
   */
  skillsNote: string
  tools: ToolSet
  decorateUserMessage: (message: string, opts: MessageDecoration) => string
}

/**
 * Load a target's context and build its turn's toolset and prompt. Returns
 * `null` when the target can't be resolved so the caller can answer cleanly.
 * `naming` is the turn's Engine's (#1223): it picks the toolset (a harness
 * gets the shared tools only) and names them in the prompt, which can name
 * only tools that toolset has.
 */
export async function prepareChatTarget<TTarget, TContext>(
  room: RoomDoc,
  spec: ChatTargetSpec<TTarget, TContext>,
  target: TTarget,
  naming: ToolNaming = BARE_TOOL_NAMING
): Promise<PreparedChatTarget<TContext> | null> {
  const context = await spec.loadContext(room, target)
  if (!context) return null
  const toolset = turnToolset(spec.tools(room, target), naming)
  return {
    kind: spec.kind,
    context,
    systemPrompt: spec.buildSystemPrompt(context, toolset.naming),
    skillsNote: renderSkillsNote(spec.skillIndex(context), toolset.naming.name),
    tools: toolset.tools,
    decorateUserMessage: (message, opts) =>
      spec.decorateUserMessage(message, opts),
  }
}

/**
 * Canvas memory (#902) for a system prompt. Every kind reads it; a read that
 * fails leaves the prompt without memory rather than failing the turn.
 */
export async function loadCanvasMemory(
  room: RoomReader
): Promise<MemoryData[]> {
  return (await room.readDoc(readMemory).catch(() => null)) ?? []
}

/**
 * The account memory (#1513) of the person who sent the turn, for its system
 * prompt. A turn nobody sent (a Coordinator wake, `senderId` null) has none:
 * `null`, so nobody's personal context leaks into it and its prompt says
 * there is no account to save to. A read that fails leaves the prompt without
 * entries rather than failing the turn.
 */
export async function loadAccountMemory(
  senderId: string | null
): Promise<MemoryData[] | null> {
  if (!senderId) return null
  return readAccountMemory(kvAccountMemoryStore(senderId)).catch(() => [])
}

/**
 * Where `write_memory` (#1515) saves a turn's account memory: its sender's
 * store, or `null` on a turn nobody sent, which refuses account writes.
 */
export function accountMemoryStore(target: {
  userId: string
  senderless?: boolean
}): AccountMemoryStore | null {
  const sender = turnSender(target)
  return sender ? kvAccountMemoryStore(sender) : null
}

/** Who sent a target's turn: its member, unless nobody did. */
export function turnSender(target: {
  userId: string
  senderless?: boolean
}): string | null {
  return target.senderless ? null : target.userId
}

/**
 * Snapshot the canvas's docs for the model's directory block. Cheap — the
 * collection is already in memory; we copy id, title and owning chat only,
 * and mark the ones whose chat was deleted.
 */
export async function loadLayerDirectory(
  room: RoomDoc
): Promise<LayerDirectory> {
  return (
    (await room
      .readDoc(({ markdownLayers, chatSessions }) => ({
        documents: markdownLayers.toArray().map((d) => ({
          id: d.id,
          title: d.title,
          ...(d.ownerChatId ? { ownerChatId: d.ownerChatId } : {}),
          ...(d.ownerChatId && !chatSessions.get(d.ownerChatId)
            ? { orphaned: true }
            : {}),
        })),
      }))
      .catch(() => null)) ?? { documents: [] }
  )
}
