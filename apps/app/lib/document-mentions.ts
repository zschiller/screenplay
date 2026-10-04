"use client"

import { useMemo } from "react"
import type { MentionItem, MentionKind } from "@/components/agent/mention-list"
import { workspaceLabel } from "@/lib/workspace-label"
import {
  useBranches,
  useChatSessions,
  useMarkdownLayers,
  useMockupLayers,
} from "@/lib/yjs/react"

/** The `.inline-ref` icon mask (`globals.css`) each kind draws. */
export const MENTION_ICON_MASK: Record<MentionKind, string> = {
  "markdown-layer": "document",
  chat: "chat",
  "mockup-layer": "mockup",
}

/** A mention node's kind; one saved before kinds existed is a document. */
export function mentionKindOf(kind: unknown): MentionKind {
  return kind === "chat" || kind === "mockup-layer" ? kind : "markdown-layer"
}

/**
 * The chats and mockups a Document's `@` lists after its documents. A chat is
 * a Workspace's (its id is the Branch's, named as the Chats menu names it) or
 * a chat with no repository (its own id). The Coordinator isn't one.
 */
export function useChatAndMockupMentions(): MentionItem[] {
  const branches = useBranches()
  const sessions = useChatSessions()
  const mockups = useMockupLayers()
  return useMemo(
    () => [
      ...branches.map((b) => ({
        kind: "chat" as const,
        id: b.id,
        label: workspaceLabel(b),
      })),
      ...sessions
        .filter((s) => s.target === "sketch")
        .map((s) => ({ kind: "chat" as const, id: s.id, label: s.label })),
      ...mockups.map((m) => ({
        kind: "mockup-layer" as const,
        id: m.id,
        label: m.title || "Untitled",
      })),
    ],
    [branches, sessions, mockups]
  )
}

/**
 * The live name of what a mention points at, so a mention follows a rename;
 * undefined when it's gone or unnamed.
 */
export function useMentionTargetLabel(
  kind: MentionKind,
  id: string
): string | undefined {
  const docs = useMarkdownLayers()
  const branches = useBranches()
  const sessions = useChatSessions()
  const mockups = useMockupLayers()
  if (kind === "markdown-layer") {
    return docs.find((d) => d.id === id)?.title || undefined
  }
  if (kind === "mockup-layer") {
    return mockups.find((m) => m.id === id)?.title || undefined
  }
  const branch = branches.find((b) => b.id === id)
  if (branch) return workspaceLabel(branch)
  return sessions.find((s) => s.id === id)?.label || undefined
}
