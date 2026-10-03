import "server-only"

import { tool } from "ai"
import { z } from "zod"

import {
  buildFrameReadTools,
  type FrameReadPorts,
} from "@/lib/agent/frame-read-tools"
import { groupToolCalls } from "@/lib/agent/group-tool-calls"
import { isHarnessPlumbing } from "@/lib/agent/tool-name"
import { renderFileWindow } from "@/lib/agent/render"
import { truncateOutput } from "@/lib/agent/search"
import { summarizeSteps } from "@/lib/agent/turn-summary"
import type { AgentMessage } from "@/lib/agent/types"
import {
  buildAttachmentsFooter,
  buildTargetedElementsFooter,
} from "@/lib/agent/message-markers"
import { workspaceLabel } from "@/lib/workspace-label"
import { annotateTools } from "@/lib/mcp/tool-server"
import { COLLECTION_KEYS, type RoomCollections } from "@/lib/yjs/schema"
import type { ChatSessionData } from "@/lib/types"

/**
 * The Coordinator's Workspace reads (#895): what a Workspace's agent said and
 * did, what its checkout changed, and what a frame looks like and holds (the
 * frame reads are shared with Workspace agents, `frame-read-tools.ts`). Every
 * tool here only reads. The Workspace agent stays the only writer of its sandbox.
 *
 * Part of the Coordinator tools module: {@link buildRoomTools} spreads these
 * in, and their ports ride on `RoomToolPorts`.
 */
export interface WorkspaceReadPorts extends FrameReadPorts {
  /** A chat's whole transcript, as the chat UI draws it on reload. */
  readChatTranscript(chatId: string): Promise<AgentMessage[]>
  /**
   * The checkout's `git diff` against its default branch, optionally for one
   * path, plus any untracked files. Throws when the checkout can't be read
   * (its sandbox isn't running).
   */
  readWorkspaceDiff(
    checkout: WorkspaceCheckout,
    opts: { path?: string }
  ): Promise<string>
  /** A file's text from the checkout, or `null` when there's no such file. */
  readWorkspaceFile(
    checkout: WorkspaceCheckout,
    path: string
  ): Promise<string | null>
}

/** What the diff and file ports need to reach a Workspace's checkout. */
export type WorkspaceCheckout = {
  sandboxName: string
  ref: string
  defaultBranch: string
}

/**
 * Caps on what the reads return, so one call can't flood the Coordinator's
 * context. A capped result says what it left out.
 */
export const WORKSPACE_READ_LIMITS = {
  /** Longest user ask shown in a chat's default view, in characters. */
  ask: 1_000,
  /** Longest full transcript; older messages drop first. */
  transcript: 60_000,
  /** Longest diff. */
  diff: 60_000,
} as const

type Reader = {
  readDoc<T>(fn: (collections: RoomCollections) => T | Promise<T>): Promise<T>
}

export function buildWorkspaceReadTools(ports: WorkspaceReadPorts & Reader) {
  const tools = {
    read_workspace_chat: tool({
      description:
        "Read what a Workspace's agent did: by default the last thing it was asked, a one-line summary of its last turn (files read and edited, commands run, failures) and its last reply. Pass `full: true` only when you need the whole transcript. Reads the Workspace's newest chat unless you pass `chatId`.",
      inputSchema: z.object({
        workspaceId: z.string().describe("The Workspace id from read_canvas"),
        chatId: z
          .string()
          .optional()
          .describe("One of the Workspace's chats, when it has several"),
        full: z
          .boolean()
          .optional()
          .describe("Return the whole transcript instead of the last turn"),
      }),
      execute: async ({ workspaceId, chatId, full }) => {
        const found = await ports.readDoc((c) => {
          const branch = c.branches.get(workspaceId)
          if (!branch) return null
          const chats = records<ChatSessionData>(
            c,
            COLLECTION_KEYS.chatSessions
          )
            .filter((chat) => chat.branchId === workspaceId)
            .sort((a, b) => a.createdAt - b.createdAt)
          return { branch, chats }
        })
        if (!found) return `Workspace not found: ${workspaceId}`
        const title = workspaceLabel(found.branch)
        const open = found.chats.filter((chat) => !chat.closedAt)
        const chat = chatId
          ? found.chats.find((c) => c.id === chatId)
          : open[open.length - 1]
        if (!chat) {
          return chatId
            ? `Workspace "${title}" has no chat ${chatId}.`
            : `Workspace "${title}" has no chat yet.`
        }

        const messages = await ports.readChatTranscript(chat.id)
        const others = open.filter((c) => c.id !== chat.id)
        const header = [
          `Workspace "${title}" · chat "${chat.label}" [${chat.id}] · ${chat.isStreaming ? "working" : "idle"}`,
          others.length > 0 &&
            `Other chats: ${others.map((c) => `"${c.label}" [${c.id}]`).join(", ")}`,
        ].filter(Boolean)
        const body = full
          ? renderTranscript(messages)
          : renderLastTurn(messages)
        return [...header, "", body].join("\n")
      },
    }),

    read_workspace_diff: tool({
      description:
        "Read a Workspace's changes: the `git diff` of its checkout against the repository's default branch (committed and uncommitted), plus untracked files. Pass `path` to see one file's changes. Read-only.",
      inputSchema: z.object({
        workspaceId: z.string().describe("The Workspace id from read_canvas"),
        path: z
          .string()
          .optional()
          .describe("Limit the diff to this path, relative to the repo root"),
      }),
      execute: async ({ workspaceId, path }) => {
        const target = await ports.readDoc((c) => checkoutOf(c, workspaceId))
        if (typeof target === "string") return target
        try {
          const diff = await ports.readWorkspaceDiff(target.checkout, { path })
          const against = `origin/${target.checkout.defaultBranch}`
          if (!diff.trim()) {
            return `Workspace "${target.title}" has no changes against ${against}${path ? ` in ${path}` : ""}.`
          }
          return [
            `Workspace "${target.title}" · branch ${target.checkout.ref} against ${against}`,
            "",
            truncateOutput(diff, WORKSPACE_READ_LIMITS.diff),
          ].join("\n")
        } catch (err) {
          return `Couldn't read Workspace "${target.title}"'s diff: ${errorText(err)}`
        }
      },
    }),

    read_workspace_file: tool({
      description:
        "Read a file from a Workspace's checkout, line-numbered like `cat -n`. Reads up to 2000 lines; pass `offset` (1-based) and `limit` to window a large file. Read-only: you can't edit Workspace files.",
      inputSchema: z.object({
        workspaceId: z.string().describe("The Workspace id from read_canvas"),
        path: z.string().describe("Path relative to the repo root"),
        offset: z.number().int().positive().optional(),
        limit: z.number().int().positive().optional(),
      }),
      execute: async ({ workspaceId, path, offset, limit }) => {
        const target = await ports.readDoc((c) => checkoutOf(c, workspaceId))
        if (typeof target === "string") return target
        try {
          const content = await ports.readWorkspaceFile(target.checkout, path)
          if (content === null) {
            return `File not found in Workspace "${target.title}": ${path}`
          }
          return renderFileWindow({ content, offset, limit })
        } catch (err) {
          return `Couldn't read ${path} from Workspace "${target.title}": ${errorText(err)}`
        }
      },
    }),
  }
  return {
    // They only read, so a harness never asks first.
    ...annotateTools(tools, {
      read_workspace_chat: { readOnlyHint: true, openWorldHint: false },
      read_workspace_diff: { readOnlyHint: true, openWorldHint: false },
      read_workspace_file: { readOnlyHint: true, openWorldHint: false },
    }),
    ...buildFrameReadTools(ports, { kind: "canvas" }),
  }
}

/**
 * A Workspace's checkout and title, or the text to answer with when it has
 * none to read.
 */
function checkoutOf(
  c: RoomCollections,
  workspaceId: string
): { title: string; checkout: WorkspaceCheckout } | string {
  const branch = c.branches.get(workspaceId)
  if (!branch) return `Workspace not found: ${workspaceId}`
  const title = workspaceLabel(branch)
  if (!branch.sandboxName) return `Workspace "${title}" has no checkout yet.`
  const repo = c.repos.get(branch.repoId)
  return {
    title,
    checkout: {
      sandboxName: branch.sandboxName,
      ref: branch.ref,
      defaultBranch: repo?.defaultBranch || "main",
    },
  }
}

/**
 * The default chat read: the last ask, a one-line summary of the turn that
 * answered it, how it ended when that wasn't a reply, and the last reply.
 */
export function renderLastTurn(messages: readonly AgentMessage[]): string {
  let start = -1
  messages.forEach((m, i) => {
    if (m.role === "user") start = i
  })
  if (start === -1) return "No messages yet."

  const ask = userTurnText(messages[start] as UserMessage)
  // Harness plumbing no chat shows.
  const steps = messages.slice(start + 1).filter((m) => !isHarnessPlumbing(m))
  const { text, failures } = summarizeSteps(groupToolCalls([...steps]))
  const didWork = steps.some((m) => m.role === "tool_call")
  const reply = [...steps].reverse().find((m) => m.role === "assistant")
  const ending = [...steps]
    .reverse()
    .find(
      (m) =>
        m.role === "stopped" ||
        m.role === "error" ||
        (m.role === "plan" && m.status === "pending")
    )

  return [
    `Last ask: ${clip(ask, WORKSPACE_READ_LIMITS.ask)}`,
    didWork &&
      `Turn summary: ${text}${failures.length > 0 ? `; failed: ${failures.join(", ")}` : ""}`,
    ending?.role === "stopped" && "The user stopped this turn.",
    ending?.role === "error" &&
      `The turn ended with an error: ${ending.content}`,
    ending?.role === "plan" &&
      `Waiting for the user to approve this plan:\n${ending.content}`,
    reply?.role === "assistant"
      ? `Last reply:\n${reply.content}`
      : "No reply yet.",
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * The whole transcript, one entry per message (reasoning left out). When it
 * runs past the cap, the oldest messages drop first.
 */
export function renderTranscript(messages: readonly AgentMessage[]): string {
  const lines = messages.flatMap((m): string[] => {
    switch (m.role) {
      case "user":
        return [`User: ${userTurnText(m)}`]
      case "assistant":
        return [`Agent: ${m.content}`]
      case "tool_call":
        return [`Tool: ${m.title} (${m.status})`]
      case "plan":
        return [`Plan (${m.status}):\n${m.content}`]
      case "error":
        return [`Error: ${m.content}`]
      case "stopped":
        return ["(The user stopped the turn.)"]
      case "reasoning":
        return []
    }
  })
  if (lines.length === 0) return "No messages yet."
  const text = lines.join("\n\n")
  const max = WORKSPACE_READ_LIMITS.transcript
  if (text.length <= max) return text
  return `…(${text.length - max} earlier characters left out)\n${text.slice(-max)}`
}

/** A collection's current records, read from the raw Y.Map (see room-tools). */
function records<T>(collections: RoomCollections, key: string): T[] {
  return Object.values(collections.doc.getMap(key).toJSON()) as T[]
}

type UserMessage = Extract<AgentMessage, { role: "user" }>

/**
 * A user turn as an agent reads it: the human's text with the
 * `Targeted elements:` and `Attached files:` footers the projection lifted
 * into fields put back, since the route, selector and file paths are what an
 * agent acts on.
 */
function userTurnText(m: UserMessage): string {
  return (
    m.content +
    buildAttachmentsFooter(m.attachments ?? []) +
    buildTargetedElementsFooter(m.targetedElements ?? [])
  )
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
