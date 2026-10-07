"use client"

import { fileIdOf, findViewOrFile } from "@/lib/yjs/file-views"
import { useCallback, useMemo, useSyncExternalStore } from "react"
import { useOptionalYjs } from "@/lib/yjs/context"
import { getRoomCollections } from "@/lib/yjs/schema"
import {
  type MentionCandidate,
  type MentionKind,
  mentionCandidates,
  mentionTargetLabel,
} from "@/lib/mention-kinds"
import {
  useBranches,
  useChatSessions,
  useLayerFiles,
  useMarkdownLayerTitles,
  useMockupLayerTitles,
} from "@/lib/yjs/react"

/**
 * What a Document's `@` list offers on this canvas: every registered kind in
 * registry order, leaving out `excludeId`, the Document typing it.
 */
export function useMentionCandidates({
  excludeId,
}: { excludeId?: string } = {}): MentionCandidate[] {
  const documents = useMarkdownLayerTitles()
  const branches = useBranches()
  const chatSessions = useChatSessions()
  const mockups = useMockupLayerTitles()
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
  const docs = useMarkdownLayerTitles()
  const branches = useBranches()
  const sessions = useChatSessions()
  const mockups = useMockupLayerTitles()
  const files = useLayerFiles()
  // A file with no view still has its name (#1884).
  const file = (fileKind: string, fileId: string) =>
    files.find((f) => f.id === fileId && f.kind === fileKind)
  return mentionTargetLabel(kind, id, {
    // A view's id or its file's (#1883).
    document: (docId) => findViewOrFile(docs, docId) ?? file("document", docId),
    mockup: (mockupId) =>
      findViewOrFile(mockups, mockupId) ?? file("mockup", mockupId),
    workspace: (branchId) => branches.find((b) => b.id === branchId),
    chat: (chatId) => sessions.find((s) => s.id === chatId),
  })
}

/**
 * Whether a mention or ref names a Document or Mockup whose file was deleted
 * (#1884): no file and no view has `id`. It reads struck through and opens
 * nothing. A file with no view isn't deleted: Files and chat still open it.
 * False for any other kind, and outside a canvas.
 */
export function useFileDeleted(kind: string, id: string): boolean {
  const doc = useOptionalYjs()?.doc
  const c = useMemo(() => (doc ? getRoomCollections(doc) : null), [doc])
  const subscribe = useCallback(
    (cb: () => void) => {
      if (!c) return () => {}
      const offs = [
        c.layerFiles.observe(cb),
        c.markdownLayers.observe(cb),
        c.mockupLayers.observe(cb),
      ]
      return () => offs.forEach((off) => off())
    },
    [c]
  )
  const getSnapshot = useCallback(
    () =>
      !!c &&
      (kind === "document" || kind === "mockup") &&
      fileIdOf(c, id) === undefined,
    [c, kind, id]
  )
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}
