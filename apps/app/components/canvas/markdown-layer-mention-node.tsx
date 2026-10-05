"use client"

import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import type { MentionKind } from "@/components/agent/mention-list"
import {
  MENTION_ICON_MASK,
  useMentionTargetLabel,
} from "@/lib/document-mentions"
import { mentionKindOf } from "@/lib/document-markdown"

/**
 * Renders a mention pill with the *live* name of what it points at: a
 * document, a chat or a mockup. The mention node stores `{ id, label, kind }`,
 * where `label` is the name at insertion time. Reading by `id` keeps the pill
 * in sync when the target is renamed instead of leaving a stale snapshot in
 * the body.
 */
export function MarkdownLayerMentionNodeView({ node }: NodeViewProps) {
  const id = node.attrs.id as string
  const kind: MentionKind = mentionKindOf(node.attrs.kind)
  const fallback = (node.attrs.label as string | undefined) ?? id
  const label = useMentionTargetLabel(kind, id) ?? fallback
  return (
    <NodeViewWrapper
      as="span"
      data-mention-id={id}
      data-mention-kind={kind}
      data-inline-ref-mask={MENTION_ICON_MASK[kind]}
      className="inline-ref"
    >
      <span className="inline-ref-label">{label}</span>
    </NodeViewWrapper>
  )
}
