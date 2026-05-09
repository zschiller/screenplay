"use client"

import { useCallback, useMemo, useRef, useState } from "react"
import { Move, MousePointer } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { useIframeLayerDrag } from "@/hooks/use-iframe-layer-drag"
import { useIframeLayerResize } from "@/hooks/use-iframe-layer-resize"
import { usePostMessage } from "@/hooks/use-postmessage"
import { GroupLabel } from "@/components/canvas/group-label"
import { ResizeHandles } from "@/components/canvas/resize-handles"
import { KnobsPopover } from "@/components/canvas/knobs-popover"
import { SKETCH_RUNTIME_BOOTSTRAP } from "@/lib/sketch-runtime/bootstrap"
import type { SketchLayerData } from "@/lib/types"
import type { JsonObject, JsonValue } from "@/lib/postmessage-protocol"

interface SketchLayerProps {
  layer: SketchLayerData
  zoom: number
  selected: boolean
  multiSelected: boolean
  spaceHeld: boolean
  flexOrder?: number
  dragTranslateX?: number
  dragTranslateY?: number
  dragPopped?: { left: number; top: number }
  groupLabel?: string
  groupSelected?: boolean
  onSelectGroup?: (shiftKey: boolean) => void
  onSelect: (id: string, shiftKey: boolean) => void
  onMoveGroup: (dx: number, dy: number) => void
  onMoveSelected: (dx: number, dy: number) => void
  onResize: (id: string, dx: number, dy: number, dw: number, dh: number) => void
  onKnobsDeclared: (id: string, knobs: JsonValue[]) => void
  onKnobValuesChange: (id: string, values: JsonObject) => void
  onSharedStateChanged: (id: string, state: JsonObject) => void
}

/**
 * Static-HTML sketch tile. Renders the model-authored `html` inside a
 * sandboxed iframe via `srcdoc`, with a small runtime bootstrap prepended so
 * the sketch can declare knobs and read/write shared state through the same
 * postMessage protocol the dev-server iframe-layer uses.
 *
 * Layout-wise this mirrors `MarkdownLayer`: it lives as a flex child of its
 * parent IframeLayerGroup, shares the same drag/resize/select chrome, and
 * draws the group label on the leftmost member.
 */
export function SketchLayer({
  layer,
  zoom,
  selected,
  multiSelected,
  spaceHeld,
  flexOrder,
  dragTranslateX,
  dragTranslateY,
  dragPopped,
  groupLabel,
  groupSelected,
  onSelectGroup,
  onSelect,
  onMoveGroup,
  onMoveSelected,
  onResize,
  onKnobsDeclared,
  onKnobValuesChange,
  onSharedStateChanged,
}: SketchLayerProps) {
  const frameRef = useRef<HTMLDivElement>(null)
  const [interactive, setInteractive] = useState(false)

  const handleDrag = useCallback(
    (dx: number, dy: number) => {
      if (selected) onMoveSelected(dx, dy)
      else onMoveGroup(dx, dy)
    },
    [selected, onMoveGroup, onMoveSelected],
  )

  const selectedOnPointerDown = useRef(false)

  const dragHandlers = useIframeLayerDrag({
    zoom,
    onDrag: handleDrag,
    onClick: (e) => {
      if (selectedOnPointerDown.current) {
        selectedOnPointerDown.current = false
        return
      }
      onSelect(layer.id, e.shiftKey)
    },
  })

  const handleResize = useCallback(
    (
      _edge: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw",
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ) => {
      onResize(layer.id, dx, dy, dw, dh)
    },
    [layer.id, onResize],
  )

  const { makeHandleProps } = useIframeLayerResize({
    zoom,
    onResize: handleResize,
  })

  // Sketches don't carry per-tile UI state (no scroll restore, no `iframeState`)
  // — the postMessage hook still needs *something*, so feed it an empty object
  // and hook up the channels we care about (knobs, sharedState).
  const emptyState = useMemo<JsonObject>(() => ({}), [])
  const handleStateChanged = useCallback(() => {}, [])

  const { iframeRef } = usePostMessage({
    iframeLayerId: layer.id,
    iframeState: emptyState,
    knobValues: layer.knobValues,
    sharedState: layer.sharedState,
    onStateChanged: handleStateChanged,
    onKnobsDeclared,
    onSharedStateChanged,
  })

  // The model authors a complete document — title + body markup + scripts.
  // Prepend our runtime bootstrap so the sketch can call `screenplay.knob(...)`
  // and `screenplay.state.*`.
  const srcdoc = SKETCH_RUNTIME_BOOTSTRAP + (layer.html || "")

  const transform =
    dragTranslateX || dragTranslateY
      ? `translate(${dragTranslateX ?? 0}px, ${dragTranslateY ?? 0}px)`
      : undefined

  const hasKnobs = Array.isArray(layer.knobs) && layer.knobs.length > 0

  return (
    <div
      id={`sketch-layer-${layer.id}`}
      ref={frameRef}
      data-sketch-layer
      className="relative shrink-0 rounded-md bg-white dark:bg-zinc-900"
      style={{
        width: layer.width,
        height: layer.height,
        order: flexOrder,
        position: dragPopped ? "absolute" : undefined,
        left: dragPopped?.left,
        top: dragPopped?.top,
        transform,
      }}
    >
      {groupLabel && (
        <div
          className="absolute bottom-full left-0 flex flex-col items-start whitespace-nowrap"
          style={{
            transform: `scale(${1 / zoom})`,
            transformOrigin: "bottom left",
            maxWidth: layer.width * zoom,
            marginBottom: 4 / zoom,
          }}
          {...(spaceHeld ? {} : dragHandlers)}
        >
          <GroupLabel
            label={groupLabel}
            groupSelected={groupSelected}
            onSelectGroup={onSelectGroup}
          />
        </div>
      )}

      {/* Top-right action row: interact toggle + knobs popover. Mirrors the
       *  iframe-layer's button row so users navigate it the same way. */}
      <div
        className="absolute right-0 bottom-full z-10 flex h-5 flex-row-reverse items-center gap-0.5"
        style={{
          transform: `scale(${1 / zoom})`,
          transformOrigin: "bottom right",
          marginBottom: 2 / zoom,
          clipPath: "inset(-4px 0 0 0)",
        }}
      >
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-xxs"
                variant={interactive ? "default" : "outline"}
                onClick={() => setInteractive((v) => !v)}
              >
                {interactive ? <Move /> : <MousePointer />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {interactive ? "Back to canvas" : "Interact"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {hasKnobs && (
          <KnobsPopover
            knobs={layer.knobs}
            values={layer.knobValues}
            onChange={(values) => onKnobValuesChange(layer.id, values)}
            anchorRef={frameRef}
          />
        )}
      </div>

      <div className="relative h-full w-full overflow-hidden rounded-md">
        <iframe
          ref={iframeRef}
          srcDoc={srcdoc}
          className="h-full w-full border-0 bg-white dark:bg-zinc-900"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          style={{ pointerEvents: interactive ? "auto" : "none" }}
        />

        {!interactive && (
          <div
            className="absolute inset-0 touch-none"
            style={{ cursor: "inherit" }}
            {...(spaceHeld ? {} : dragHandlers)}
            onPointerDownCapture={(e) => {
              if (e.button === 0 && !spaceHeld) {
                selectedOnPointerDown.current = false
                if (groupSelected && !e.shiftKey) return
                if (!selected || e.shiftKey) {
                  selectedOnPointerDown.current = true
                  onSelect(layer.id, e.shiftKey)
                }
              }
            }}
          />
        )}
      </div>

      {selected && !multiSelected && (
        <ResizeHandles zoom={zoom} makeHandleProps={makeHandleProps} />
      )}
    </div>
  )
}
