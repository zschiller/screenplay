import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react"

import { resolveEscapeAction, type EscapeAction } from "@/lib/canvas/escape"
import { reconcileInteractionMode } from "@/lib/canvas/interaction-mode"
import type { ToolMode } from "@/lib/canvas/tool-mode"
import type { IframeLayerData } from "@/lib/types"
import type { CanvasPresence } from "@/lib/yjs/react"

/**
 * Canvas Interaction controller (PRD #588) — the single home for the
 * cross-cutting interaction state no other controller owned, lifted out of the
 * Canvas composition root where it was smeared across half a dozen `useState`s
 * and three effects. It owns the Focus ("interactive") Iframe Layer, the Create
 * Flow ("flow") Iframe Layer, the hovered Iframe Layer, the inline-edited
 * Markdown Layer, the space-held (pan) flag, and the cursor-chat anchor.
 *
 * The decisions stay in the React-free modules this controller wraps without
 * touching: `reconcileInteractionMode` (drop a mode when its frame is deleted or
 * deselected, pinned by `interaction-mode.test.ts`) drives the reconcile effect,
 * and `resolveEscapeAction` (the Escape precedence, pinned by `escape.test.ts`)
 * backs the `resolveEscape` verb the keyboard handler dispatches on. The
 * controller is the thin adapter — owns the state, mirrors the long-lived inputs
 * into refs so its verbs read the latest snapshot without re-binding, and feeds
 * both pure modules.
 *
 * Cursor chat spans this state and awareness: the anchor is local interaction
 * state, but the live message rides in presence (`self.message`). The controller
 * owns the anchor and the open/close verbs, reading the awareness mirrors
 * (`selfPointerRef` / `selfMessageRef`) and broadcasting through the injected
 * `setPresence` — exactly the seam the root used before the lift.
 */
export interface CanvasInteractionDeps {
  /** Live, synced Iframe Layers — reconciled against to drop a dead mode. */
  iframeLayers: IframeLayerData[]
  /** Selected Iframe Layers — a deselected frame drops its Focus/Flow mode. */
  selectedIframeLayerIds: ReadonlySet<string>
  /** Awareness setter — cursor chat broadcasts its live message through it. */
  setPresence: (partial: Partial<CanvasPresence>) => void
  /** Latest self cursor position (canvas space), mirrored from awareness. */
  selfPointerRef: RefObject<{ x: number; y: number } | null>
  /** Latest self cursor-chat message (null = closed), mirrored from awareness. */
  selfMessageRef: RefObject<string | null>
}

export interface CanvasInteraction {
  /** The focused ("interactive") Iframe Layer, or null when not focused. */
  focusedIframeLayerId: string | null
  setFocusedIframeLayerId: Dispatch<SetStateAction<string | null>>
  /** The Iframe Layer in Create Flow ("flow") mode, or null. */
  createFlowIframeLayerId: string | null
  setCreateFlowIframeLayerId: Dispatch<SetStateAction<string | null>>
  /**
   * Live Create-Flow id mirror — the route writer (`useLayerMutations`) reads it
   * so its `updateRoute` callback stays stable across Create-Flow toggles.
   */
  createFlowIframeLayerIdRef: RefObject<string | null>
  /** The Iframe Layer under the cursor (hover highlight), or null. */
  hoveredIframeLayerId: string | null
  setHoveredIframeLayerId: Dispatch<SetStateAction<string | null>>
  /** The Markdown Layer being edited inline, or null. */
  editingDocumentLayerId: string | null
  setEditingDocumentLayerId: Dispatch<SetStateAction<string | null>>
  /** True while the space bar is held (drives pan cursor + gesture pan). */
  spaceHeld: boolean
  setSpaceHeld: Dispatch<SetStateAction<boolean>>
  /**
   * Canvas-space pointer snapshot taken when '/' opened cursor chat, or null
   * when closed. Snapshotting keeps the bubble put while the user types.
   */
  chatAnchor: { x: number; y: number } | null
  /** Open cursor chat at the current pointer (no-op if the pointer is unknown). */
  openCursorChat(): void
  /** Close cursor chat and clear the broadcast message. */
  closeCursorChat(): void
  /** Whether cursor chat is currently open (the awareness message is set). */
  isCursorChatOpen(): boolean
  /**
   * Resolve the single Escape action for the current interaction state. The
   * tool/comment bits Escape also reads aren't owned here, so the caller passes
   * them in; the rest is read from this controller's mirror refs.
   */
  resolveEscape(input: {
    toolMode: ToolMode
    hasNewCommentPos: boolean
  }): EscapeAction
}

export function useCanvasInteraction(
  deps: CanvasInteractionDeps
): CanvasInteraction {
  const {
    iframeLayers,
    selectedIframeLayerIds,
    setPresence,
    selfPointerRef,
    selfMessageRef,
  } = deps

  const [focusedIframeLayerId, setFocusedIframeLayerId] = useState<
    string | null
  >(null)
  // IframeLayer currently in Create Flow mode. Mutually exclusive with
  // `focusedIframeLayerId` — toggling one clears the other.
  const [createFlowIframeLayerId, setCreateFlowIframeLayerId] = useState<
    string | null
  >(null)
  const [hoveredIframeLayerId, setHoveredIframeLayerId] = useState<
    string | null
  >(null)
  const [editingDocumentLayerId, setEditingDocumentLayerId] = useState<
    string | null
  >(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  // Figma-style cursor chat. `chatAnchor` snapshots the canvas-space pointer
  // position at the moment '/' is pressed so the bubble stays put while the
  // user types instead of jittering with every micro-mouse-move. Live message
  // text lives in awareness so peers see each keystroke (`presence.message`).
  const [chatAnchor, setChatAnchor] = useState<{ x: number; y: number } | null>(
    null
  )

  // Mirror the mode/edit state into refs so the long-lived keyboard handler (via
  // `resolveEscape`) and the route writer read the latest value without
  // re-binding. Written after commit, not during render.
  const focusedIframeLayerIdRef = useRef(focusedIframeLayerId)
  const createFlowIframeLayerIdRef = useRef(createFlowIframeLayerId)
  const editingDocumentLayerIdRef = useRef(editingDocumentLayerId)
  useEffect(() => {
    focusedIframeLayerIdRef.current = focusedIframeLayerId
    createFlowIframeLayerIdRef.current = createFlowIframeLayerId
    editingDocumentLayerIdRef.current = editingDocumentLayerId
  })

  // Drop out of Focus or Create Flow mode the instant the frame it targets is
  // gone OR deselected, so the canvas pans/zooms/scrolls again with no Escape
  // needed. We reconcile against the live layer set and the current selection
  // rather than patching each delete/deselect call-site, so every exit path is
  // covered at once — single-frame remove, keyboard Delete/Backspace,
  // Group-cascade delete, a remote collaborator deleting the frame out from
  // under us, and the user clicking away to deselect the frame. Writes back only
  // when an id actually changed, so unrelated layer edits don't churn state or
  // fight the Escape handler.
  useEffect(() => {
    const existingLayerIds = new Set(iframeLayers.map((layer) => layer.id))
    const next = reconcileInteractionMode({
      focusedId: focusedIframeLayerId,
      createFlowId: createFlowIframeLayerId,
      existingLayerIds,
      selectedLayerIds: selectedIframeLayerIds,
    })
    if (next.focusedId !== focusedIframeLayerId) {
      // Syncing mode state down from the external Y.Doc layer set; the guard
      // above keeps this from looping.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFocusedIframeLayerId(next.focusedId)
    }
    if (next.createFlowId !== createFlowIframeLayerId) {
      setCreateFlowIframeLayerId(next.createFlowId)
    }
  }, [
    iframeLayers,
    focusedIframeLayerId,
    createFlowIframeLayerId,
    selectedIframeLayerIds,
  ])

  const closeCursorChat = useCallback(() => {
    setChatAnchor(null)
    setPresence({ message: null })
  }, [setPresence])

  const openCursorChat = useCallback(() => {
    const ptr = selfPointerRef.current
    if (!ptr) return
    setChatAnchor(ptr)
    setPresence({ message: "" })
  }, [setPresence, selfPointerRef])

  const isCursorChatOpen = useCallback(
    () => selfMessageRef.current !== null,
    [selfMessageRef]
  )

  const resolveEscape = useCallback(
    (input: {
      toolMode: ToolMode
      hasNewCommentPos: boolean
    }): EscapeAction =>
      resolveEscapeAction({
        cursorChatOpen: selfMessageRef.current !== null,
        editingDocumentLayerId: editingDocumentLayerIdRef.current,
        toolMode: input.toolMode,
        hasNewCommentPos: input.hasNewCommentPos,
        focusedIframeLayerId: focusedIframeLayerIdRef.current,
        createFlowIframeLayerId: createFlowIframeLayerIdRef.current,
      }),
    [selfMessageRef]
  )

  return {
    focusedIframeLayerId,
    setFocusedIframeLayerId,
    createFlowIframeLayerId,
    setCreateFlowIframeLayerId,
    createFlowIframeLayerIdRef,
    hoveredIframeLayerId,
    setHoveredIframeLayerId,
    editingDocumentLayerId,
    setEditingDocumentLayerId,
    spaceHeld,
    setSpaceHeld,
    chatAnchor,
    openCursorChat,
    closeCursorChat,
    isCursorChatOpen,
    resolveEscape,
  }
}
