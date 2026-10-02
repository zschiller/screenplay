"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { FloatingToolbar } from "@workspace/ui/components/floating-toolbar"
import { CaretDownIcon } from "@workspace/ui/components/icons"
import { InputGroupButton } from "@workspace/ui/components/input-group"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover"

import {
  Composer,
  type ComposerSubmitPayload,
} from "@/components/agent/composer"
import { NEW_CHAT, type FrameAnswerer } from "@/lib/frame-ask"
import type { BranchData, MarkdownLayerData } from "@/lib/types"
import { WorkspaceCommandList, WorkspaceName } from "./workspace-list"

/** Keeps the card clear of the canvas edges and the bottom tool toolbar. */
const INSET = 8
const CANVAS_TOOLBAR_STRIP = 48

/**
 * Marks a popup a composer opens outside the card (the `@` and `/` pickers),
 * so a pointer-down in it doesn't count as clicking away.
 */
export const COMPOSER_POPUP_ATTRIBUTE = "data-composer-popup"

/**
 * The ask a drawn frame opens (#1356, spec #1355): the chat composer on the
 * shared floating surface, centred on the frame in screen space, so it reads
 * the same at any zoom. A chip where the model pill sits says who answers and
 * switches it (#1357): New chat or any Workspace, starting from the default the
 * canvas worked out from the selection. A new chat's turn uses the default
 * model; a Workspace's chat keeps its own.
 *
 * Per-viewer: the canvas holds which frame is asking in local state, never in
 * the room doc. Enter sends; Esc or a pointer-down outside closes it, leaving
 * the frame as it is.
 */
export function FrameAskCard({
  frameId,
  markdownLayers,
  workspaces,
  defaultAnswerer,
  onSubmit,
  onClose,
}: {
  frameId: string
  markdownLayers: MarkdownLayerData[]
  /** Every Workspace, for the chip's menu. */
  workspaces: BranchData[]
  defaultAnswerer: FrameAnswerer
  onSubmit: (payload: ComposerSubmitPayload, answerer: FrameAnswerer) => void
  onClose: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [answerer, setAnswerer] = useState(defaultAnswerer)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Centre the card on the frame every frame, the way the frame bar follows
  // its frame: the frame lives inside the world transform, the card in screen
  // space. Hidden until the frame has mounted and the card is placed.
  useEffect(() => {
    const wrapper = document.querySelector<HTMLElement>("[data-canvas-wrapper]")
    if (!wrapper) return
    let rafId = 0
    const tick = () => {
      const frame = document.getElementById(`iframe-layer-${frameId}`)
      const card = cardRef.current
      if (frame && card) {
        const fr = frame.getBoundingClientRect()
        const cw = wrapper.getBoundingClientRect()
        const w = card.offsetWidth
        const h = card.offsetHeight
        const x = fr.left - cw.left + (fr.width - w) / 2
        const y = fr.top - cw.top + (fr.height - h) / 2
        const clampedX = Math.max(INSET, Math.min(x, cw.width - w - INSET))
        const clampedY = Math.max(
          INSET,
          Math.min(y, cw.height - CANVAS_TOOLBAR_STRIP - h)
        )
        card.style.transform = `translate(${clampedX}px, ${clampedY}px)`
        card.style.visibility = "visible"
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [frameId])

  // A pointer-down anywhere but the card (or a picker it opened) closes it.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Node)) return
      if (cardRef.current?.contains(target)) return
      if (
        target instanceof Element &&
        target.closest(`[${COMPOSER_POPUP_ATTRIBUTE}]`)
      )
        return
      onCloseRef.current()
    }
    document.addEventListener("pointerdown", onPointerDown, true)
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true)
  }, [])

  const portal =
    typeof document !== "undefined"
      ? document.getElementById("frame-toolbar-portal")
      : null
  if (!portal) return null

  return createPortal(
    <FloatingToolbar
      ref={cardRef}
      role="dialog"
      aria-label="What should this frame show?"
      className="invisible absolute top-0 left-0 block w-88 max-w-[calc(100%-1rem)] p-1"
      // React bubbles a portal's events up its owner tree, through the
      // canvas's gesture handlers; the card is not the canvas.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      // Caught on the way down: the composer claims Esc for itself (it lets
      // go of focus). An open `@` or `/` picker still takes it first.
      onKeyDownCapture={(e) => {
        if (e.key !== "Escape") return
        if (document.querySelector(`[${COMPOSER_POPUP_ATTRIBUTE}]`)) return
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }}
    >
      <Composer
        markdownLayers={markdownLayers}
        onModelChange={() => {}}
        onSubmit={(payload) => onSubmit(payload, answerer)}
        focusKey={1}
        placeholder="What should this frame show?"
        modelSlot={
          <AnswererChip
            answerer={answerer}
            workspaces={workspaces}
            onChange={setAnswerer}
          />
        }
        // The card is the surface: the composer's own box goes borderless.
        className="relative [&_[data-slot=input-group]]:border-transparent dark:[&_[data-slot=input-group]]:bg-transparent"
      />
    </FloatingToolbar>,
    portal
  )
}

/**
 * Who answers, in the model pill's place and look (#1357). Its menu is the
 * frames' Workspace list with New chat first.
 */
function AnswererChip({
  answerer,
  workspaces,
  onChange,
}: {
  answerer: FrameAnswerer
  workspaces: BranchData[]
  onChange: (answerer: FrameAnswerer) => void
}) {
  const [open, setOpen] = useState(false)
  const workspace =
    answerer.kind === "workspace"
      ? workspaces.find((b) => b.id === answerer.branchId)
      : undefined
  const pick = (next: FrameAnswerer) => {
    onChange(next)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className="-ml-1.5 inline-flex min-w-0">
        <PopoverTrigger asChild>
          <InputGroupButton
            size="xs"
            aria-label="Who answers"
            className="max-w-48 text-xs text-foreground"
          >
            {workspace ? <WorkspaceName workspace={workspace} /> : "New chat"}
            <CaretDownIcon />
          </InputGroupButton>
        </PopoverTrigger>
      </span>
      <PopoverContent
        {...{ [COMPOSER_POPUP_ATTRIBUTE]: "" }}
        className="w-72 p-0"
        side="bottom"
        align="start"
      >
        <WorkspaceCommandList
          branches={workspaces}
          currentBranchId={workspace?.id}
          onPick={(branchId) => pick({ kind: "workspace", branchId })}
          newChat={{ current: !workspace, onPick: () => pick(NEW_CHAT) }}
        />
      </PopoverContent>
    </Popover>
  )
}
