"use client"

import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import { Crosshair } from "lucide-react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card"
import { MENTION_TEXT_CLASS } from "@/lib/mention-styles"
import { ElementDetail } from "./element-detail"
import { useElementHighlight } from "./use-element-highlight"

/**
 * React node view for the composer's atomic element token (PRD #616, slice
 * #620). It renders the same sky-blue, `font-mono`, crosshair-prefixed label as
 * the static `renderHTML`, but wraps it in a shadcn HoverCard so hovering
 * reveals the messy detail hidden from the inline label — the full CSS selector
 * (mono), the route, and the frame label.
 *
 * Hovering also highlights the referenced element on the canvas: while the card
 * is open (via the shared `useElementHighlight`, which the sent-message
 * history token uses too); it clears on close and on unmount (message sent /
 * token deleted).
 */
export function ElementTokenNodeView({ node }: NodeViewProps) {
  const label = (node.attrs.label as string | undefined) ?? ""
  const ref = (node.attrs.ref as string | undefined) ?? ""
  const selector = (node.attrs.selector as string | undefined) ?? ""
  const iframeLayerId = (node.attrs.iframeLayerId as string | undefined) ?? ""
  const route = (node.attrs.route as string | undefined) ?? "/"
  const frameLabel = (node.attrs.frameLabel as string | undefined) ?? ""

  const handleOpenChange = useElementHighlight(ref, iframeLayerId, selector)

  return (
    <NodeViewWrapper as="span" data-element-token="" className="inline">
      <HoverCard onOpenChange={handleOpenChange}>
        <HoverCardTrigger asChild>
          <span
            className={`${MENTION_TEXT_CLASS} cursor-default font-mono`}
            contentEditable={false}
          >
            {/*
              Leading zero-width space. When this token is the FIRST child of
              the editor (no editable text before it), Chrome anchors the
              collapsed caret at the earliest *text* position inside this
              non-editable span. The crosshair is an <svg> — not a text position
              — so without this the caret skips it and lands between the icon and
              the label. The `@`/`/` mentions never show this because their first
              child is a text node (`@…`); the ZWSP gives us the same left-edge
              text anchor so the caret sits to the left of the icon. This is the
              documented ProseMirror/contenteditable workaround — see
              https://github.com/ProseMirror/prosemirror/issues/991. Invisible
              (zero width) and composer-only; the sent bubble uses renderHTML.
            */}
            {"\u200B"}
            <Crosshair className="mr-0.5 inline size-[1em] align-[-0.15em]" />
            {label}
          </span>
        </HoverCardTrigger>
        <HoverCardContent align="start">
          <ElementDetail
            selector={selector}
            route={route}
            frameLabel={frameLabel}
          />
        </HoverCardContent>
      </HoverCard>
    </NodeViewWrapper>
  )
}
