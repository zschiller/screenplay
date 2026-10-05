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
import { accountFiles } from "@/lib/files"
import { agentContextFolder } from "@/lib/files/context-folder"
import type { Files } from "@/lib/files/files"
import type { FileEntryData, MemoryData } from "@/lib/types"
import type { SkillMetadata } from "@/lib/skills/frontmatter"
import { accountSkills } from "@/lib/skills/account"
import type { SavedSkills } from "@/lib/skills/saved"
import type { SkillSources } from "@/lib/skills/sources"

/**
 * The seam every chat target kind fills: a Branch's Workspace
 * (`workspace-chat-target.ts`), the whole Room's Coordinator
 * (`room-chat-target.ts`), or a Sketch Chat with no repository
 * (`sketch-chat-target.ts`). A Document is no longer a target (#1314): a
 * Workspace chat writes the Documents it owns with its own tools. Each kind's
 * module holds the code paths that change between targets:
 *
 *   - `skills` builds the chat's Skill Sources (`lib/skills/sources.ts`,
 *     #1664): which Skills it sees, its App Skills among them. The prompt's
 *     index, `read_skill`, the harness context folder and a Mockup's
 *     `skill:` references all read that one value, so no other code picks a
 *     chat's Skills by its kind.
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
  /** `room` is `null` off a canvas, which has no Canvas Skills. */
  skills(room: RoomDoc | null, target: TTarget): SkillSources
  /** `skills` is the turn's, built by {@link ChatTargetSpec.skills} if absent. */
  loadContext(
    room: RoomDoc,
    target: TTarget,
    skills?: SkillSources
  ): Promise<TContext | null>
  buildSystemPrompt(ctx: TContext, naming: ToolNaming): string
  skillIndex(ctx: TContext): readonly SkillMetadata[]
  tools(room: RoomDoc, target: TTarget, skills?: SkillSources): ChatTools
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
 * only tools that toolset has. `skills` is the turn's Skill Sources, when the
 * turn built them already for its harness's context folder.
 */
export async function prepareChatTarget<TTarget, TContext>(
  room: RoomDoc,
  spec: ChatTargetSpec<TTarget, TContext>,
  target: TTarget,
  naming: ToolNaming = BARE_TOOL_NAMING,
  skills: SkillSources = spec.skills(room, target)
): Promise<PreparedChatTarget<TContext> | null> {
  const context = await spec.loadContext(room, target, skills)
  if (!context) return null
  const toolset = turnToolset(spec.tools(room, target, skills), naming)
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

/**
 * The Account Files (#1521) of the person who sent the turn, for its system
 * prompt: like {@link loadAccountMemory}, `null` on a turn nobody sent, and
 * a failed read leaves the prompt without entries.
 */
export async function loadAccountFiles(
  senderId: string | null
): Promise<FileEntryData[] | null> {
  if (!senderId) return null
  const listed = await accountFiles(senderId)
    .list()
    .catch(() => null)
  return listed?.ok ? listed.value : []
}

/**
 * The files the saved-file tools reach for the `account` scope (#1521): the
 * turn sender's, or `null` on a turn nobody sent, which refuses the scope.
 */
export function accountFilesFor(target: {
  userId: string
  senderless?: boolean
}): Files | null {
  const sender = turnSender(target)
  return sender ? accountFiles(sender) : null
}

/**
 * The Skills `save_skill` and `delete_skill` keep for the `account` scope
 * (#1558): the turn sender's, or `null` on a turn nobody sent, which refuses
 * the scope.
 */
export function accountSkillsFor(target: {
  userId: string
  senderless?: boolean
}): SavedSkills | null {
  const sender = turnSender(target)
  return sender ? accountSkills(sender) : null
}

/**
 * Where a turn's harness reads the saved files on disk (#1524): the chat's
 * context folder, or `null` on the in-process engine, which has no disk.
 */
export function contextFolderFor(
  harnessKey: string | null | undefined,
  chatId: string | undefined
): string | null {
  return harnessKey && chatId ? agentContextFolder(chatId) : null
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
