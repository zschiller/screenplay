"use client"

import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import { useFileDeleted, useMentionTargetLabel } from "@/lib/document-mentions"
import {
  MENTION_KIND_REGISTRY,
  type MentionKind,
  mentionKindOf,
} from "@/lib/mention-kinds"

/**
 * Renders a mention pill with the *live* name of what it points at: a
 * document, a chat or a mockup. The mention node stores `{ id, label, kind }`,
 * where `label` is the name at insertion time. Reading by `id` keeps the pill
 * in sync when the target is renamed instead of leaving a stale snapshot in
 * the body. A Document or Mockup whose file was deleted keeps its last name,
 * struck through (#1884).
 */
export function MarkdownLayerMentionNodeView({ node }: NodeViewProps) {
  const id = node.attrs.id as string
  const kind: MentionKind = mentionKindOf(node.attrs.kind)
  const fallback = (node.attrs.label as string | undefined) ?? id
  const label = useMentionTargetLabel(kind, id) ?? fallback
  // A Document or Mockup whose file was deleted reads struck through (#1884).
  const deleted = useFileDeleted(kind, id)
  return (
    <NodeViewWrapper
      as="span"
      data-mention-id={id}
      data-mention-kind={kind}
      data-deleted={deleted || undefined}
      data-inline-ref-mask={MENTION_KIND_REGISTRY[kind].mask}
      className="inline-ref"
    >
      <span className="inline-ref-label">{label}</span>
    </NodeViewWrapper>
  )
}
