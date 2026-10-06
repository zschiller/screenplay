"use client"

import { useCallback, useMemo, useRef, useState } from "react"

import {
  DEFAULT_IFRAME_LAYER_WIDTH,
  DEFAULT_IFRAME_LAYER_HEIGHT,
  MOCKUP_MIN_HEIGHT,
  MOCKUP_MIN_WIDTH,
} from "@/lib/constants"
import type { CanvasDrawTool } from "./use-canvas-gesture"
import type { ToolModeController } from "./use-tool-mode"

/** A box in canvas (world) space. */
export type DrawnRect = { x: number; y: number; width: number; height: number }

/** An in-flight draw-tool draft rect in canvas (world) space. */
type Draft = {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

export interface DrawToolController {
  /**
   * The draft-driven draw tool the Canvas Gesture seam shares its pointer
   * handlers with but that isn't a gesture — it creates a Layer on release
   * rather than reducing through the FSM.
   */
  drawTool: CanvasDrawTool
  /** The document-tool draft rect drawn by SelectionOverlay, or null when idle. */
  documentDraft: Draft | null
  /** The frame-tool draft rect drawn by SelectionOverlay, or null when idle. */
  frameDraft: Draft | null
  /** The Mockup-tool draft rect drawn by SelectionOverlay, or null when idle. */
  mockupDraft: Draft | null
  /**
   * A click on a group's trailing add-member placeholder: appends a member of
   * the armed tool's kind to that group, selects it, and drops back to Select,
   * the same as releasing a drawn draft.
   */
  addAtPlaceholder: (groupId: string) => void
}

/**
 * The Document / Frame / Mockup draw tools (PRD #567 — the Tool Mode sibling). Owns the
 * in-flight draft rect for each tool (state + the commit-time ref the gesture's
 * pointer handlers write) and the draft → new-Layer commit: default sizes,
 * click-vs-drag bounds, the `ops`-backed create, and the post-create selection.
 *
 * Lives next to Tool Mode because it is the apply-side of the Frame/Document
 * tools the toolbar arms — the component armed the tool, the FSM shares its
 * pointer stream, and this hook turns a released draft into a committed Layer.
 */
export function useDrawTool({
  documentMode,
  frameMode,
  mockupMode = false,
  addDocumentLayer,
  addFrame,
  addIframeLayerToGroup,
  addDocumentLayerToGroup,
  toolMode,
  setSelectedIframeLayerIds,
  setSelectedDocumentLayerIds,
  setSelectedGroupIds,
  setEditingDocumentLayerId,
  onFrameDrawn,
  onMockupDrawn,
}: {
  documentMode: boolean
  frameMode: boolean
  mockupMode?: boolean
  addDocumentLayer: (
    x: number,
    y: number,
    width: number,
    height: number
  ) => string
  addFrame: (x: number, y: number, width: number, height: number) => string
  addIframeLayerToGroup: (groupId: string) => string | undefined
  addDocumentLayerToGroup: (groupId: string) => string | undefined
  toolMode: ToolModeController
  setSelectedIframeLayerIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setSelectedDocumentLayerIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setSelectedGroupIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setEditingDocumentLayerId: (id: string | null) => void
  /**
   * A drawn frame was let go: the canvas opens its ask card (#1356). Gets the
   * new frame's id and the rect it was drawn at, in canvas space.
   */
  onFrameDrawn?: (frameId: string, rect: DrawnRect) => void
  /**
   * A Mockup box was let go (#1359): the canvas keeps the box drawn and opens
   * its ask. Nothing is created: the Mockup is only made when the ask is sent.
   */
  onMockupDrawn?: (rect: DrawnRect) => void
}): DrawToolController {
  const [documentDraft, setDocumentDraft] = useState<Draft | null>(null)
  const documentDraftRef = useRef<Draft | null>(null)
  const [frameDraft, setFrameDraft] = useState<Draft | null>(null)
  const frameDraftRef = useRef<Draft | null>(null)
  const [mockupDraft, setMockupDraft] = useState<Draft | null>(null)
  const mockupDraftRef = useRef<Draft | null>(null)

  const drawTool = useMemo<CanvasDrawTool>(
    () => ({
      beginDraft: (canvas) => {
        if (documentMode) {
          documentDraftRef.current = {
            startX: canvas.x,
            startY: canvas.y,
            currentX: canvas.x,
            currentY: canvas.y,
          }
          setDocumentDraft(documentDraftRef.current)
        } else if (frameMode) {
          frameDraftRef.current = {
            startX: canvas.x,
            startY: canvas.y,
            currentX: canvas.x,
            currentY: canvas.y,
          }
          setFrameDraft(frameDraftRef.current)
        } else if (mockupMode) {
          mockupDraftRef.current = {
            startX: canvas.x,
            startY: canvas.y,
            currentX: canvas.x,
            currentY: canvas.y,
          }
          setMockupDraft(mockupDraftRef.current)
        }
      },
      updateDraft: (canvas) => {
        if (documentDraftRef.current) {
          const next = {
            ...documentDraftRef.current,
            currentX: canvas.x,
            currentY: canvas.y,
          }
          documentDraftRef.current = next
          setDocumentDraft(next)
          return true
        }
        if (frameDraftRef.current) {
          const next = {
            ...frameDraftRef.current,
            currentX: canvas.x,
            currentY: canvas.y,
          }
          frameDraftRef.current = next
          setFrameDraft(next)
          return true
        }
        if (mockupDraftRef.current) {
          const next = {
            ...mockupDraftRef.current,
            currentX: canvas.x,
            currentY: canvas.y,
          }
          mockupDraftRef.current = next
          setMockupDraft(next)
          return true
        }
        return false
      },
      commitDraft: () => {
        // Document-tool: release creates a new document layer. Click-without-drag
        // uses a sensible default size; drag sets explicit bounds.
        if (documentDraftRef.current) {
          const d = documentDraftRef.current
          documentDraftRef.current = null
          setDocumentDraft(null)
          const dx = d.currentX - d.startX
          const dy = d.currentY - d.startY
          const DEFAULT_W = 480
          const DEFAULT_H = 640
          let x: number
          let y: number
          let w: number
          let h: number
          if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
            w = DEFAULT_W
            h = DEFAULT_H
            x = d.startX
            y = d.startY
          } else {
            x = Math.min(d.startX, d.currentX)
            y = Math.min(d.startY, d.currentY)
            w = Math.max(200, Math.abs(dx))
            h = Math.max(120, Math.abs(dy))
          }
          const id = addDocumentLayer(
            Math.round(x),
            Math.round(y),
            Math.round(w),
            Math.round(h)
          )
          toolMode.set("select")
          setSelectedIframeLayerIds(new Set())
          setSelectedDocumentLayerIds(new Set([id]))
          setEditingDocumentLayerId(id)
          return true
        }
        // Frame-tool: release creates a new empty frame, then asks what it
        // should show.
        if (frameDraftRef.current) {
          const d = frameDraftRef.current
          frameDraftRef.current = null
          setFrameDraft(null)
          const rect = drawnRect(d, {
            width: DEFAULT_IFRAME_LAYER_WIDTH,
            height: DEFAULT_IFRAME_LAYER_HEIGHT,
          })
          const id = addFrame(rect.x, rect.y, rect.width, rect.height)
          toolMode.set("select")
          setSelectedDocumentLayerIds(new Set())
          setSelectedIframeLayerIds(new Set([id]))
          onFrameDrawn?.(id, rect)
          return true
        }
        // Mockup-tool: release creates nothing; it hands the box to the canvas
        // to ask what to sketch in it. The Mockup is only made when the ask is
        // sent, so backing out leaves nothing to delete.
        if (mockupDraftRef.current) {
          const d = mockupDraftRef.current
          mockupDraftRef.current = null
          setMockupDraft(null)
          const rect = drawnRect(d, {
            width: DEFAULT_IFRAME_LAYER_WIDTH,
            height: DEFAULT_IFRAME_LAYER_HEIGHT,
          })
          rect.width = Math.max(MOCKUP_MIN_WIDTH, rect.width)
          rect.height = Math.max(MOCKUP_MIN_HEIGHT, rect.height)
          toolMode.set("select")
          onMockupDrawn?.(rect)
          return true
        }
        return false
      },
    }),
    [
      documentMode,
      frameMode,
      mockupMode,
      onMockupDrawn,
      addDocumentLayer,
      addFrame,
      toolMode,
      setSelectedIframeLayerIds,
      setSelectedDocumentLayerIds,
      setEditingDocumentLayerId,
      onFrameDrawn,
    ]
  )

  const addAtPlaceholder = useCallback(
    (groupId: string) => {
      if (documentMode) {
        const newId = addDocumentLayerToGroup(groupId)
        if (!newId) return
        toolMode.set("select")
        setSelectedDocumentLayerIds(new Set([newId]))
        setSelectedIframeLayerIds(new Set())
        setSelectedGroupIds(new Set())
        return
      }
      if (frameMode) {
        const newId = addIframeLayerToGroup(groupId)
        if (!newId) return
        toolMode.set("select")
        setSelectedIframeLayerIds(new Set([newId]))
        setSelectedGroupIds(new Set())
        setSelectedDocumentLayerIds(new Set())
      }
    },
    [
      documentMode,
      frameMode,
      addDocumentLayerToGroup,
      addIframeLayerToGroup,
      toolMode,
      setSelectedIframeLayerIds,
      setSelectedDocumentLayerIds,
      setSelectedGroupIds,
    ]
  )

  return { drawTool, documentDraft, frameDraft, mockupDraft, addAtPlaceholder }
}

/**
 * The box a released draft stands for: the dragged rect, or on a click (under
 * 3px of travel) the default size centred on the click. Whole world pixels
 * either way: a drag at a fractional zoom lands between them.
 */
function drawnRect(
  d: Draft,
  fallback: { width: number; height: number }
): DrawnRect {
  const dx = d.currentX - d.startX
  const dy = d.currentY - d.startY
  if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
    return {
      x: Math.round(d.startX - fallback.width / 2),
      y: Math.round(d.startY - fallback.height / 2),
      width: fallback.width,
      height: fallback.height,
    }
  }
  return {
    x: Math.round(Math.min(d.startX, d.currentX)),
    y: Math.round(Math.min(d.startY, d.currentY)),
    width: Math.round(Math.abs(dx)),
    height: Math.round(Math.abs(dy)),
  }
}
