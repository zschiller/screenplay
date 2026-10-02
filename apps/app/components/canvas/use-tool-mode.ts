import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  reduceToolMode,
  type ToolMode,
  type ToolModeTool,
} from "@/lib/canvas/tool-mode"

/**
 * Tool Mode controller (PRD #567) — owns which draw tool is armed (Select /
 * Frame / Mockup / Document / Comment) as one discriminated value, lifted out of
 * `components/canvas/canvas.tsx` where it lived as three independent booleans.
 *
 * The pure transition stays in `lib/canvas/tool-mode`: {@link reduceToolMode}
 * decides the next mode, so mutual exclusion holds by construction. This
 * controller is the thin apply-side — it owns the React state, mirrors the
 * current mode into a ref for the long-lived keydown handler (which feeds the
 * Tool Mode union to the Escape resolver), and exposes `set` / `toggle` plus
 * the boolean reads the render tree and gesture inputs consume.
 *
 * The toolbar buttons and keyboard shortcuts each dispatch one intent, so the
 * "clear the other three" sites that used to keep the booleans exclusive are
 * gone. Resetting the comment-placement sub-state (new-comment position,
 * inspect hover) stays at the call sites — that sub-state is deliberately not
 * part of Tool Mode.
 */
export interface ToolModeController {
  /** The single armed tool. */
  mode: ToolMode
  /** Convenience boolean reads (for render + gesture inputs). */
  isSelect: boolean
  frameMode: boolean
  mockupMode: boolean
  documentMode: boolean
  commentMode: boolean
  /**
   * Whether the Frame tool can be armed. A frame shows a Workspace, and a
   * Workspace needs a repository, so a canvas with none can't draw frames.
   */
  frameAvailable: boolean
  /** Synchronous read for the long-lived keydown handler. */
  current(): ToolMode
  /** Arm a specific mode (Select button / `V` key, or an Escape exit). */
  set(mode: ToolMode): void
  /** Toggle a tool against Select (a button / shortcut pressed again). */
  toggle(tool: ToolModeTool): void
}

export function useToolMode({
  frameAvailable = true,
}: { frameAvailable?: boolean } = {}): ToolModeController {
  const [armed, setMode] = useState<ToolMode>("select")
  // A Frame tool armed before the last repository went reads as Select.
  const mode = armed === "frame" && !frameAvailable ? "select" : armed
  const frameAvailableRef = useRef(frameAvailable)

  const modeRef = useRef(mode)
  useEffect(() => {
    modeRef.current = mode
    frameAvailableRef.current = frameAvailable
  })

  const current = useCallback(() => modeRef.current, [])
  // Arming an unavailable Frame tool (its key, a stray click) does nothing.
  const set = useCallback((next: ToolMode) => {
    if (next === "frame" && !frameAvailableRef.current) return
    setMode(next)
  }, [])
  const toggle = useCallback((tool: ToolModeTool) => {
    if (tool === "frame" && !frameAvailableRef.current) return
    setMode((prev) => reduceToolMode(prev, { type: "toggle", tool }))
  }, [])

  return useMemo(
    () => ({
      mode,
      isSelect: mode === "select",
      frameMode: mode === "frame",
      mockupMode: mode === "mockup",
      documentMode: mode === "document",
      commentMode: mode === "comment",
      frameAvailable,
      current,
      set,
      toggle,
    }),
    [mode, frameAvailable, current, set, toggle]
  )
}
