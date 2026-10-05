"use client"

import { ReactRenderer } from "@tiptap/react"
import type { MentionOptions } from "@tiptap/extension-mention"
import {
  MentionList,
  type MentionItem,
  type MentionListHandle,
} from "@/components/agent/mention-list"

/**
 * Item shape passed into the suggestion popover. `kind` is preserved on the
 * resulting Mention node so the agent's message-extraction code can tell
 * which `read_*` tool the model should call to follow the reference.
 */
export type LayerMentionItem = MentionItem

/**
 * Build a TipTap Mention `suggestion` config over the given candidates
 * (`mentionCandidates` / `useMentionCandidates`, already in registry order).
 * The agent chat input lists documents; a Document's body lists every kind.
 */
export function buildLayerMentionSuggestion(opts: {
  /** What to offer, every kind in registry order. */
  getItems: () => MentionItem[]
  /**
   * Optional anchor element for clamping the popover horizontally so it
   * doesn't escape the chat panel / document tile bounds.
   */
  getAnchorRect?: () => DOMRect | null
  /**
   * Optional: open below the caret, as a Document's `/` menu does, rather
   * than above it as the composer's does.
   */
  below?: boolean
  /** Optional input box the popover sits above, clear of its border. */
  getInputBoxRect?: () => DOMRect | null
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
      // Up to 12 of each kind, so many documents never hide the rest.
      const perKind = new Map<string, number>()
      return opts.getItems().filter((item) => {
        if (!item.label.toLowerCase().includes(q)) return false
        const n = perKind.get(item.kind) ?? 0
        perKind.set(item.kind, n + 1)
        return n < 12
      })
    },
    render: () => {
      let component: ReactRenderer<MentionListHandle> | null = null
      let containerEl: HTMLDivElement | null = null

      const positionContainer = (rect: DOMRect | null) => {
        if (!containerEl || !rect) return
        const anchor = opts.getAnchorRect?.()
        const minLeft = anchor ? anchor.left + 4 : 4
        const maxLeft = anchor ? anchor.right - 280 : window.innerWidth - 280
        const left = Math.max(minLeft, Math.min(rect.left, maxLeft))
        containerEl.style.left = `${left}px`
        if (opts.below) {
          containerEl.style.top = `${rect.bottom + 4}px`
          return
        }
        // Above the box the caret is typing in, when there is one, so the
        // popover never covers its border.
        const box = opts.getInputBoxRect?.()
        const top = box ? Math.min(box.top, rect.top) : rect.top
        containerEl.style.bottom = `${window.innerHeight - top + 4}px`
      }

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, {
            props: { items: props.items, command: props.command },
            editor: props.editor,
          })
          containerEl = document.createElement("div")
          // Outside any composer's DOM; marked so a card that closes on a
          // pointer-down elsewhere (the frame ask card) leaves it be.
          containerEl.setAttribute("data-composer-popup", "")
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
