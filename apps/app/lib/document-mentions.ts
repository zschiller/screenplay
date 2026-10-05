"use client"

import { useMemo } from "react"
import {
  type MentionCandidate,
  type MentionKind,
  mentionCandidates,
  mentionTargetLabel,
} from "@/lib/mention-kinds"
import {
  useBranches,
  useChatSessions,
  useMarkdownLayers,
  useMockupLayers,
} from "@/lib/yjs/react"

/**
 * What a Document's `@` list offers on this canvas: every registered kind in
 * registry order, leaving out `excludeId`, the Document typing it.
 */
export function useMentionCandidates({
  excludeId,
}: { excludeId?: string } = {}): MentionCandidate[] {
  const documents = useMarkdownLayers()
  const branches = useBranches()
  const chatSessions = useChatSessions()
  const mockups = useMockupLayers()
  return useMemo(
    () =>
      mentionCandidates(
        { documents, branches, chatSessions, mockups },
        { excludeId }
      ),
    [documents, branches, chatSessions, mockups, excludeId]
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
