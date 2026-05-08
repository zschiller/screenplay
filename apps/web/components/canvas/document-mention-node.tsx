"use client"

import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import { useDocumentLayers } from "@/lib/yjs/react"

/**
 * Renders a mention pill with the *live* title of the target document.
 * The mention node stores `{ id, label }`, where `label` is the title at
 * insertion time. Reading by `id` keeps the pill in sync when the target
 * doc is renamed instead of leaving a stale snapshot in the body.
 */
export function DocumentMentionNodeView({ node }: NodeViewProps) {
  const id = node.attrs.id as string
  const fallback = (node.attrs.label as string | undefined) ?? id
  const docs = useDocumentLayers()
  const live = docs.find((d) => d.id === id)?.title
  const label = live && live.length > 0 ? live : fallback
  return (
    <NodeViewWrapper
      as="span"
      data-mention-id={id}
      className="mention-doc-pill inline-block rounded bg-primary/10 px-1 py-0.5 text-[0.95em] leading-none text-primary no-underline"
    >
      {label}
    </NodeViewWrapper>
  )
}
