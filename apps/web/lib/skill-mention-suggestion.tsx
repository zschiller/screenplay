"use client"

import { ReactRenderer } from "@tiptap/react"
import type { MentionOptions } from "@tiptap/extension-mention"
import {
  SkillMentionList,
  type SkillMentionItem,
  type SkillMentionListHandle,
} from "@/components/agent/skill-mention-list"

/**
 * Build a TipTap Mention `suggestion` config for the `/` skill picker. It is
 * registered alongside the `@` layer-mention suggestion on the *same* Mention
 * extension (v3's `suggestions` array), so picked skills become Mention nodes
 * tagged with `mentionSuggestionChar: "/"`.
 *
 * Two behaviors set it apart from `@`:
 *  - **start-of-input only** — the menu opens only when `/` is the very first
 *    character of the message, so a literal slash mid-sentence is preserved;
 *  - **at most one Skill per message** — once a skill chip exists, `/` no
 *    longer triggers the menu.
 */
export function buildSkillMentionSuggestion(opts: {
  getSkills: () => SkillMentionItem[]
  /** True while the per-Branch index is still being fetched. */
  getLoading?: () => boolean
  /** Optional anchor element for clamping the popover horizontally. */
  getAnchorRect?: () => DOMRect | null
  /** Notified when the popover opens (true) or closes (false). */
  onOpenChange?: (open: boolean) => void
}): NonNullable<MentionOptions["suggestion"]> {
  return {
    char: "/",
    // `/` is a deliberate explicit-invocation affordance, not a free-text
    // trigger: it fires only at the start of the message and only when no
    // skill chip is present yet (one Skill per message).
    allow: ({ state, range }) => {
      // Start-of-input: position 1 is the first character slot of the doc's
      // first block, so a `/` anywhere else (mid-sentence) is left literal.
      if (range.from !== 1) return false
      // The node must be insertable here (mirrors the extension's default
      // content-match guard).
      const $from = state.doc.resolve(range.from)
      const type = state.schema.nodes.mention
      if (type && !$from.parent.type.contentMatch.matchType(type)) return false
      // One Skill per message: bail if a skill chip already exists.
      let hasSkill = false
      state.doc.descendants((node) => {
        if (
          node.type.name === "mention" &&
          node.attrs.mentionSuggestionChar === "/"
        ) {
          hasSkill = true
          return false
        }
        return undefined
      })
      return !hasSkill
    },
    items: ({ query }) => {
      const q = query.toLowerCase()
      return opts
        .getSkills()
        .filter(
          (s) =>
            s.name.toLowerCase().includes(q) ||
            s.description.toLowerCase().includes(q)
        )
        .slice(0, 12)
    },
    render: () => {
      let component: ReactRenderer<SkillMentionListHandle> | null = null
      let containerEl: HTMLDivElement | null = null

      const positionContainer = (rect: DOMRect | null) => {
        if (!containerEl || !rect) return
        const anchor = opts.getAnchorRect?.()
        const minLeft = anchor ? anchor.left + 4 : 4
        const maxLeft = anchor ? anchor.right - 320 : window.innerWidth - 320
        const left = Math.max(minLeft, Math.min(rect.left, maxLeft))
        containerEl.style.left = `${left}px`
        containerEl.style.bottom = `${window.innerHeight - rect.top + 4}px`
      }

      return {
        onStart: (props) => {
          component = new ReactRenderer(SkillMentionList, {
            props: {
              items: props.items,
              command: props.command,
              loading: opts.getLoading?.() ?? false,
            },
            editor: props.editor,
          })
          containerEl = document.createElement("div")
          containerEl.style.position = "fixed"
          containerEl.style.zIndex = "60"
          containerEl.style.minWidth = "260px"
          containerEl.style.maxWidth = "320px"
          containerEl.appendChild(component.element)
          document.body.appendChild(containerEl)
          positionContainer(props.clientRect ? props.clientRect() : null)
          opts.onOpenChange?.(true)
        },
        onUpdate: (props) => {
          component?.updateProps({
            items: props.items,
            command: props.command,
            loading: opts.getLoading?.() ?? false,
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
