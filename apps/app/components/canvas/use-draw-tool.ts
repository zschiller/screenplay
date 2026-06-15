"use client"

import { useMemo, useRef, useState } from "react"

import {
  DEFAULT_IFRAME_LAYER_WIDTH,
  DEFAULT_IFRAME_LAYER_HEIGHT,
} from "@/lib/constants"
import type { CanvasDrawTool } from "./use-canvas-gesture"
import type { ToolModeController } from "./use-tool-mode"

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
}

/**
 * The Document / Frame draw tools (PRD #567 — the Tool Mode sibling). Owns the
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
  addDocumentLayer,
  addFrame,
  toolMode,
  setSelectedIframeLayerIds,
  setSelectedDocumentLayerIds,
  setEditingDocumentLayerId,
}: {
  documentMode: boolean
  frameMode: boolean
  addDocumentLayer: (
    x: number,
    y: number,
    width: number,
    height: number
  ) => string
  addFrame: (x: number, y: number, width: number, height: number) => string
  toolMode: ToolModeController
  setSelectedIframeLayerIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setSelectedDocumentLayerIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setEditingDocumentLayerId: (id: string | null) => void
}): DrawToolController {
  const [documentDraft, setDocumentDraft] = useState<Draft | null>(null)
  const documentDraftRef = useRef<Draft | null>(null)
  const [frameDraft, setFrameDraft] = useState<Draft | null>(null)
  const frameDraftRef = useRef<Draft | null>(null)

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
          const id = addDocumentLayer(x, y, w, h)
          toolMode.set("select")
          setSelectedIframeLayerIds(new Set())
          setSelectedDocumentLayerIds(new Set([id]))
          setEditingDocumentLayerId(id)
          return true
        }
        // Frame-tool: release creates a new empty frame.
        if (frameDraftRef.current) {
          const d = frameDraftRef.current
          frameDraftRef.current = null
          setFrameDraft(null)
          const dx = d.currentX - d.startX
          const dy = d.currentY - d.startY
          let x: number
          let y: number
          let w: number
          let h: number
          if (Math.abs(dx) < 3 && Math.abs(dy) < 3) {
            w = DEFAULT_IFRAME_LAYER_WIDTH
            h = DEFAULT_IFRAME_LAYER_HEIGHT
            x = d.startX - w / 2
            y = d.startY - h / 2
          } else {
            x = Math.min(d.startX, d.currentX)
            y = Math.min(d.startY, d.currentY)
            w = Math.abs(dx)
            h = Math.abs(dy)
          }
          const id = addFrame(x, y, w, h)
          toolMode.set("select")
          setSelectedDocumentLayerIds(new Set())
          setSelectedIframeLayerIds(new Set([id]))
          return true
        }
        return false
      },
    }),
    [
      documentMode,
      frameMode,
      addDocumentLayer,
      addFrame,
      toolMode,
      setSelectedIframeLayerIds,
      setSelectedDocumentLayerIds,
      setEditingDocumentLayerId,
    ]
  )

  return { drawTool, documentDraft, frameDraft }
}
