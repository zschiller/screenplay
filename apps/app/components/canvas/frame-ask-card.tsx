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
import { NEW_CHAT, NEW_SKETCH_CHAT, type FrameAnswerer } from "@/lib/draw-ask"
import type {
  BranchData,
  ChatSessionData,
  MarkdownLayerData,
} from "@/lib/types"
import { WorkspaceCommandList, WorkspaceName } from "./workspace-list"

/** Keeps the card clear of the canvas edges and the bottom tool toolbar. */
const INSET = 8
const CANVAS_TOOLBAR_STRIP = 48

/**
 * Marks a popup a composer opens outside the card (the `@` and `/` pickers),
 * so a pointer-down in it doesn't count as clicking away.
 */
export const COMPOSER_POPUP_ATTRIBUTE = "data-composer-popup"

/** Where the drawn box sits on screen, relative to the canvas wrapper. */
export type AskCardTarget = {
  left: number
  top: number
  width: number
  height: number
}

/** The drawn box a card asks about: a frame, or a Mockup box (#1359). */
export type AskCardKind = "frame" | "mockup"

const QUESTION: Record<AskCardKind, string> = {
  frame: "What should this frame show?",
  mockup: "What should this mockup show?",
}

/**
 * Where a frame sits on screen, relative to the canvas wrapper: the frame
 * lives inside the world transform, the card in screen space.
 */
export function frameAskTarget(frameId: string): AskCardTarget | null {
  const wrapper = document.querySelector<HTMLElement>("[data-canvas-wrapper]")
  const frame = document.getElementById(`iframe-layer-${frameId}`)
  if (!wrapper || !frame) return null
  const fr = frame.getBoundingClientRect()
  const cw = wrapper.getBoundingClientRect()
  return {
    left: fr.left - cw.left,
    top: fr.top - cw.top,
    width: fr.width,
    height: fr.height,
  }
}

/**
 * The ask a drawn frame or Mockup box opens (#1356, #1359, spec #1355): the
 * chat composer on the shared floating surface, centred on the box in screen
 * space, so it reads the same at any zoom. A chip where the model pill sits
 * says who answers and switches it (#1357): New chat or any Workspace,
 * starting from the default the canvas worked out from the selection. A new
 * chat's turn uses the default model; a Workspace's chat keeps its own.
 *
 * Per-viewer: the canvas holds which box is asking in local state, never in
 * the room doc. Enter sends; Esc or a pointer-down outside closes it, leaving
 * a frame as it is (an unsent Mockup box goes with the card).
 */
export function FrameAskCard({
  kind = "frame",
  locate,
  markdownLayers,
  workspaces,
  sketchChats,
  defaultAnswerer,
  onSubmit,
  onClose,
}: {
  kind?: AskCardKind
  /** The box's screen rect, read every animation frame; null until it's up. */
  locate: () => AskCardTarget | null
  markdownLayers: MarkdownLayerData[]
  /** Every Workspace, for the chip's menu. */
  workspaces: BranchData[]
  /**
   * The chats with no repository, for a Mockup box's chip. Given, the chip
   * offers them and a new one; on a canvas with no repository it offers only
   * those.
   */
  sketchChats?: ChatSessionData[]
  defaultAnswerer: FrameAnswerer
  onSubmit: (payload: ComposerSubmitPayload, answerer: FrameAnswerer) => void
  onClose: () => void
}) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [answerer, setAnswerer] = useState(defaultAnswerer)
  const onCloseRef = useRef(onClose)
  const locateRef = useRef(locate)
  useEffect(() => {
    onCloseRef.current = onClose
    locateRef.current = locate
  })

  // Centre the card on the box every frame, the way the frame bar follows its
  // frame. Hidden until the box is up and the card is placed.
  useEffect(() => {
    const wrapper = document.querySelector<HTMLElement>("[data-canvas-wrapper]")
    if (!wrapper) return
    let rafId = 0
    const tick = () => {
      const box = locateRef.current()
      const card = cardRef.current
      if (box && card) {
        const cw = wrapper.getBoundingClientRect()
        const w = card.offsetWidth
        const h = card.offsetHeight
        const x = box.left + (box.width - w) / 2
        const y = box.top + (box.height - h) / 2
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
  }, [])

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
      aria-label={QUESTION[kind]}
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
        placeholder={QUESTION[kind]}
        modelSlot={
          <AnswererChip
            answerer={answerer}
            workspaces={workspaces}
            sketchChats={sketchChats}
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
 * frames' Workspace list with New chat first, and for a Mockup box the chats
 * with no repository after it. On a canvas with no repository a new chat with
 * none is the default; with nothing else to pick, the chip only says so.
 */
function AnswererChip({
  answerer,
  workspaces,
  sketchChats,
  onChange,
}: {
  answerer: FrameAnswerer
  workspaces: BranchData[]
  sketchChats?: ChatSessionData[]
  onChange: (answerer: FrameAnswerer) => void
}) {
  const [open, setOpen] = useState(false)
  const workspace =
    answerer.kind === "workspace"
      ? workspaces.find((b) => b.id === answerer.branchId)
      : undefined
  const sketchChat =
    answerer.kind === "sketch" && answerer.chatId
      ? sketchChats?.find((c) => c.id === answerer.chatId)
      : undefined
  // No repository: only chats with none can answer.
  const noRepository = answerer.kind === "sketch" && workspaces.length === 0
  if (noRepository && !sketchChats?.length) {
    return (
      <span className="inline-flex min-w-0 items-center pl-0.75 text-sm text-foreground">
        New chat
      </span>
    )
  }
  const label = workspace ? (
    <WorkspaceName workspace={workspace} />
  ) : sketchChat ? (
    <span className="truncate">{sketchChat.label}</span>
  ) : answerer.kind === "sketch" && !noRepository ? (
    "New chat, no repository"
  ) : (
    "New chat"
  )
  const pick = (next: FrameAnswerer) => {
    onChange(next)
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <span className="-ml-1.5 inline-flex min-w-0">
        <PopoverTrigger asChild>
          <InputGroupButton
            size="sm"
            aria-label="Who answers"
            className="max-w-48 text-foreground"
          >
            {label}
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
          newChat={
            noRepository
              ? undefined
              : {
                  current: answerer.kind === "new-chat",
                  onPick: () => pick(NEW_CHAT),
                }
          }
          sketch={
            sketchChats
              ? {
                  chats: sketchChats,
                  current:
                    answerer.kind === "sketch"
                      ? (answerer.chatId ?? "new")
                      : null,
                  onPick: (chatId) =>
                    pick(chatId ? { kind: "sketch", chatId } : NEW_SKETCH_CHAT),
                }
              : undefined
          }
        />
      </PopoverContent>
    </Popover>
  )
}
