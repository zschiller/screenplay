"use client"

import { ReactRenderer } from "@tiptap/react"
import type { MentionOptions } from "@tiptap/extension-mention"
import { MentionList, type MentionListHandle } from "@/components/agent/mention-list"
import type { DocumentLayerData } from "@/lib/types"

/**
 * Build a TipTap Mention `suggestion` config that filters the live document
 * list and renders a Tailwind-styled popover anchored to the editor caret.
 *
 * Both the agent chat input and document body editors use this so a `@`
 * means the same thing everywhere — pick a document, attach its id, and let
 * `Mention.renderText` display it as `@<title>` in serialized output.
 */
export function buildDocumentMentionSuggestion(opts: {
  /** Always returns the latest documents so the popover sees fresh titles. */
  getDocuments: () => DocumentLayerData[]
  /**
   * Optional: a doc id to exclude from the candidate list — the document
   * doing the mentioning shouldn't be able to mention itself.
   */
  getExcludeId?: () => string | undefined
  /**
   * Optional anchor element for clamping the popover horizontally so it
   * doesn't escape the chat panel / document tile bounds.
   */
  getAnchorRect?: () => DOMRect | null
}): MentionOptions["suggestion"] {
  return {
    char: "@",
    items: ({ query }) => {
      const q = query.toLowerCase()
      const exclude = opts.getExcludeId?.()
      return opts
        .getDocuments()
        .filter((d) => d.id !== exclude)
        .map((d) => ({ id: d.id, label: d.title || "Untitled" }))
        .filter((d) => d.label.toLowerCase().includes(q))
        .slice(0, 8)
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
        },
      }
    },
  }
}
