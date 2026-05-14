"use client"

import { ReactRenderer } from "@tiptap/react"
import type { MentionOptions } from "@tiptap/extension-mention"
import { MentionList, type MentionListHandle } from "@/components/agent/mention-list"
import type { MarkdownLayerData } from "@/lib/types"

/**
 * Item shape passed into the suggestion popover. `kind` is preserved on the
 * resulting Mention node so the agent's message-extraction code can tell
 * which `read_*` tool the model should call to follow the reference.
 */
export interface LayerMentionItem {
  kind: "markdown-layer"
  id: string
  label: string
}

/**
 * Build a TipTap Mention `suggestion` config listing documents on the
 * canvas. Both the agent chat input and the markdown body editor wire `@`
 * to this so a single picker covers every chat-targetable layer kind.
 */
export function buildLayerMentionSuggestion(opts: {
  getMarkdownLayers: () => MarkdownLayerData[]
  /**
   * Optional: a layer id to exclude from the candidate list — a doc
   * shouldn't be able to @-mention itself.
   */
  getExcludeId?: () => string | undefined
  /**
   * Optional anchor element for clamping the popover horizontally so it
   * doesn't escape the chat panel / document tile bounds.
   */
  getAnchorRect?: () => DOMRect | null
  /**
   * Notified when the popover opens (true) or closes (false). Lets the host
   * editor suppress its own Enter handler while the suggestion is active —
   * ProseMirror checks direct `editorProps` before plugin props, so without
   * this signal a host-level submit-on-Enter handler will fire before the
   * suggestion plugin gets a chance to consume the key.
   */
  onOpenChange?: (open: boolean) => void
}): MentionOptions["suggestion"] {
  return {
    char: "@",
    items: ({ query }) => {
      const q = query.toLowerCase()
      const exclude = opts.getExcludeId?.()
      const docs: LayerMentionItem[] = opts
        .getMarkdownLayers()
        .filter((d) => d.id !== exclude)
        .map((d) => ({
          kind: "markdown-layer" as const,
          id: d.id,
          label: d.title || "Untitled",
        }))
      return docs
        .filter((item) => item.label.toLowerCase().includes(q))
        .slice(0, 12)
    },
    render: () => {
      let component: ReactRenderer<MentionListHandle> | null = null
      let containerEl: HTMLDivElement | null = null

      const positionContainer = (rect: DOMRect | null) => {
        if (!containerEl || !rect) return
        const anchor = opts.getAnchorRect?.()
        const minLeft = anchor ? anchor.left + 4 : 4
        const maxLeft = anchor
          ? anchor.right - 280
          : window.innerWidth - 280
        const left = Math.max(minLeft, Math.min(rect.left, maxLeft))
        containerEl.style.left = `${left}px`
        containerEl.style.bottom = `${window.innerHeight - rect.top + 4}px`
      }

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, {
            props: { items: props.items, command: props.command },
            editor: props.editor,
          })
          containerEl = document.createElement("div")
          containerEl.style.position = "fixed"
          containerEl.style.zIndex = "60"
          containerEl.style.minWidth = "224px"
          containerEl.appendChild(component.element)
          document.body.appendChild(containerEl)
          positionContainer(props.clientRect ? props.clientRect() : null)
          opts.onOpenChange?.(true)
        },
        onUpdate: (props) => {
          component?.updateProps({
            items: props.items,
            command: props.command,
          })
          positionContainer(props.clientRect ? props.clientRect() : null)
        },
        onKeyDown: (props) => {
          if (props.event.key === "Escape") return false
          return component?.ref?.onKeyDown(props.event) ?? false
        },
        onExit: () => {
          if (containerEl) {
            containerEl.remove()
            containerEl = null
          }
          component?.destroy()
          component = null
          opts.onOpenChange?.(false)
        },
      }
    },
  }
}
