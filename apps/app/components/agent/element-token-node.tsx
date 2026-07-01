"use client"

import { useEffect } from "react"
import { NodeViewWrapper } from "@tiptap/react"
import type { NodeViewProps } from "@tiptap/react"
import { Crosshair } from "lucide-react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card"
import { MENTION_TEXT_CLASS } from "@/lib/mention-styles"
import { targetingStore } from "@/lib/targeting-store"

/**
 * React node view for the composer's atomic element token (PRD #616, slice
 * #620). It renders the same sky-blue, `font-mono`, crosshair-prefixed label as
 * the static `renderHTML`, but wraps it in a shadcn HoverCard so hovering
 * reveals the messy detail hidden from the inline label — the full CSS selector
 * (mono), the route, and the frame label.
 *
 * Hovering also highlights the referenced element on the canvas: while the card
 * is open we push a `HighlightTarget` into the targeting store, which the Canvas
 * routes to the frame's bridge to draw an outline. It clears on close and on
 * unmount (message sent / token deleted). All of this is composer-only — the
 * sent chat bubble renders tokens as static spans via `elementMarkersToPills`,
 * with no node view and no highlight.
 */
export function ElementTokenNodeView({ node }: NodeViewProps) {
  const label = (node.attrs.label as string | undefined) ?? ""
  const ref = (node.attrs.ref as string | undefined) ?? ""
  const selector = (node.attrs.selector as string | undefined) ?? ""
  const iframeLayerId = (node.attrs.iframeLayerId as string | undefined) ?? ""
  const route = (node.attrs.route as string | undefined) ?? "/"
  const frameLabel = (node.attrs.frameLabel as string | undefined) ?? ""

  // Clear any highlight this token owns when it unmounts — a sent message, a
  // deleted token, or a torn-down composer must not leave a stuck outline.
  useEffect(() => {
    return () => targetingStore.clearHighlight(ref)
  }, [ref])

  const handleOpenChange = (open: boolean) => {
    if (open && iframeLayerId && selector) {
      targetingStore.setHighlight({ iframeLayerId, selector, ref })
    } else {
      targetingStore.clearHighlight(ref)
    }
  }

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
        <HoverCardContent align="start" className="gap-2">
          <div className="font-mono text-xs break-all text-foreground">
            {selector || "(no selector)"}
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <div className="flex gap-1.5">
              <span className="shrink-0 text-foreground/60">Route</span>
              <span className="font-mono break-all">{route}</span>
            </div>
            {frameLabel ? (
              <div className="flex gap-1.5">
                <span className="shrink-0 text-foreground/60">Frame</span>
                <span className="break-all">{frameLabel}</span>
              </div>
            ) : null}
          </div>
        </HoverCardContent>
      </HoverCard>
    </NodeViewWrapper>
  )
}
