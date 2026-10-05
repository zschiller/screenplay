"use client"

import { useMemo } from "react"
import type { MentionItem, MentionKind } from "@/components/agent/mention-list"
import { workspaceLabel } from "@/lib/workspace-label"
import { mentionTargetLabel } from "@/lib/document-markdown"
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
 * undefined when it's gone or unnamed. `read_document` names it the same way.
 */
export function useMentionTargetLabel(
  kind: MentionKind,
  id: string
): string | undefined {
  const docs = useMarkdownLayers()
  const branches = useBranches()
  const sessions = useChatSessions()
  const mockups = useMockupLayers()
  return mentionTargetLabel(kind, id, {
    document: (docId) => docs.find((d) => d.id === docId),
    mockup: (mockupId) => mockups.find((m) => m.id === mockupId),
    workspace: (branchId) => branches.find((b) => b.id === branchId),
    chat: (chatId) => sessions.find((s) => s.id === chatId),
  })
}
