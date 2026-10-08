import { type RefObject, useEffect } from "react"
import { type PanelImperativeHandle } from "react-resizable-panels"

import { resolveEscapeAction, type EscapeState } from "@/lib/canvas/escape"
import { keyTargetOf } from "@/lib/canvas/key-target"
import { matchCanvasKey } from "@/lib/canvas/shortcuts"
import { commenting } from "@/lib/capabilities"

import type { CanvasInteraction } from "@/components/canvas/use-canvas-interaction"
import type { CanvasSelection } from "@/components/canvas/use-canvas-selection"
import type { ElementReference } from "@/components/canvas/use-element-reference"
import type { ElementTargetingController } from "@/components/canvas/use-element-targeting"
import type { ToolModeController } from "@/components/canvas/use-tool-mode"

/**
 * Canvas Keyboard controller (PRD #579) — the single home for the global
 * `keydown`/`keyup` listeners on the canvas. It is a dispatch from action to
 * verb: which key means what, and where each key is allowed (in text entry, in
 * the Composer, in an open menu or dialog), is the table in
 * `lib/canvas/shortcuts` (#1264), matched by the React-free `matchCanvasKey`
 * over where the key landed (`keyTargetOf`). The same table feeds the `?` sheet
 * and the zoom menu's key hints, and the player reuses the matcher for ⌘I.
 *
 * Escape is one action in the table; which exit it takes is the pure
 * precedence in `resolveEscapeAction` (`lib/canvas/escape.ts`, pinned by
 * `escape.test.ts`). Its inputs are gathered in one place, `readEscapeState`,
 * and this controller only applies the chosen exit (including cancelling an
 * armed Element Targeting pick, the top of the precedence).
 */
export interface CanvasKeyboardInputs {
  /** Tool Mode controller — the `/`-resolver source plus the tool dispatches. */
  toolMode: ToolModeController
  /** Canvas Selection controller — Escape's clear and Delete/Backspace. */
  selection: CanvasSelection
  /** Element Reference controller — comment-mode placement read + clear. */
  reference: ElementReference
  /** Element Targeting controller — Escape cancels an armed pick first. */
  targeting: Pick<ElementTargetingController, "isPickActive" | "cancel">
  /** Yjs undo/redo, scoped to room storage. */
  history: { undo: () => void; redo: () => void }
  /**
   * Canvas Interaction controller — owns the Focus / Create-Flow / editing /
   * space-held / cursor-chat state. Escape reads its `escapeState` and
   * applies the mode/edit/cursor-chat exits through its verbs; `/` opens
   * cursor chat and space toggles its pan flag.
   */
  interaction: CanvasInteraction
  /** Side panels toggled by ⌘B (sidebar), ⌘I (chat), and ⌘. (both). */
  sidebarPanelRef: RefObject<PanelImperativeHandle | null>
  chatPanelRef: RefObject<PanelImperativeHandle | null>
  /** Zoom verbs for ⌘= / ⌘- / ⌘0 / ⇧1. */
  zoom: {
    zoomIn: () => void
    zoomOut: () => void
    zoomTo100: () => void
    zoomToFit: () => void
  }
  /** Opens the `?` keyboard shortcut sheet. */
  openShortcutSheet: () => void
  /** The Comments panel, which Escape closes from anywhere on the canvas. */
  commentsPanel: { isOpen: () => boolean; close: () => void }
  /** A viewer's canvas (#1933): the keys that draw or change layers do nothing. */
  readOnly?: boolean
}

/** What a viewer's keys skip: every action that draws or changes the canvas. */
const EDIT_ACTIONS = new Set([
  "tool-document",
  "tool-frame",
  "tool-mockup",
  "delete-selection",
  "duplicate-selection",
  "undo",
  "redo",
])

export function useCanvasKeyboard({
  toolMode,
  selection,
  reference,
  targeting,
  history,
  interaction,
  sidebarPanelRef,
  chatPanelRef,
  zoom,
  openShortcutSheet,
  commentsPanel,
  readOnly = false,
}: CanvasKeyboardInputs): void {
  useEffect(() => {
    // Everything Escape's precedence reads, gathered in one place: the
    // Interaction controller's own state plus the target-pick, tool and
    // comment bits the other controllers own.
    const readEscapeState = (): EscapeState => ({
      ...interaction.escapeState(),
      targetPickActive: targeting.isPickActive(),
      toolMode: toolMode.current(),
      hasNewCommentPos: reference.newCommentPos !== null,
      commentsPanelOpen: commentsPanel.isOpen(),
    })

    const togglePanel = (panel: PanelImperativeHandle | null) => {
      if (!panel) return
      if (panel.isCollapsed()) panel.expand()
      else panel.collapse()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      const action = matchCanvasKey(e, keyTargetOf(e.target), {
        comments: commenting,
      })
      if (readOnly && action && EDIT_ACTIONS.has(action)) return
      switch (action) {
        case null:
          return
        case "escape":
          // The precedence (innermost/most-transient first) lives in the
          // React-free `resolveEscapeAction`; this switch just applies the
          // chosen exit. The focus / Create Flow steps are the two manual mode
          // exits pinned by lib/canvas/escape.test.ts.
          switch (resolveEscapeAction(readEscapeState())) {
            case "cancel-target-pick":
              e.preventDefault()
              targeting.cancel()
              break
            case "close-cursor-chat":
              interaction.closeCursorChat()
              break
            case "stop-editing-document":
              interaction.setEditingDocumentLayerId(null)
              break
            case "exit-document-mode":
              toolMode.set("select")
              break
            case "exit-frame-mode":
            case "exit-mockup-mode":
              toolMode.set("select")
              break
            case "exit-comment-mode":
              toolMode.set("select")
              reference.clearMode()
              break
            case "close-comments-panel":
              commentsPanel.close()
              break
            case "exit-focus-mode":
              interaction.setFocusedIframeLayerId(null)
              break
            case "exit-create-flow-mode":
              interaction.setCreateFlowIframeLayerId(null)
              break
            case "clear-selection":
              selection.clear()
              break
          }
          return
        case "zoom-in":
          e.preventDefault()
          return zoom.zoomIn()
        case "zoom-out":
          e.preventDefault()
          return zoom.zoomOut()
        case "zoom-to-100":
          e.preventDefault()
          return zoom.zoomTo100()
        case "zoom-to-fit":
          e.preventDefault()
          return zoom.zoomToFit()
        case "shortcut-sheet":
          e.preventDefault()
          return openShortcutSheet()
        // The draw tools each dispatch one Tool Mode intent; the union keeps
        // the tools mutually exclusive, so there's no "clear the other three"
        // to do here. Resetting the comment-placement sub-state stays.
        case "tool-select":
          toolMode.set("select")
          return reference.clearMode()
        case "tool-comment":
          toolMode.toggle("comment")
          return reference.clearMode()
        case "tool-document":
          toolMode.toggle("document")
          return reference.clearMode()
        case "tool-frame":
          toolMode.toggle("frame")
          return reference.clearMode()
        case "tool-mockup":
          toolMode.toggle("mockup")
          return reference.clearMode()
        // Figma-style cursor chat. Opens an inline input next to the cursor
        // and broadcasts each keystroke through awareness so peers see the
        // message floating beside the user's remote cursor.
        case "cursor-chat":
          if (interaction.isCursorChatOpen()) return
          e.preventDefault()
          return interaction.openCursorChat()
        case "toggle-sidebar":
          e.preventDefault()
          return togglePanel(sidebarPanelRef.current)
        case "toggle-chat":
          e.preventDefault()
          return togglePanel(chatPanelRef.current)
        case "toggle-panels": {
          e.preventDefault()
          const sidebarPanel = sidebarPanelRef.current
          const chatPanel = chatPanelRef.current
          const anyOpen =
            (sidebarPanel && !sidebarPanel.isCollapsed()) ||
            (chatPanel && !chatPanel.isCollapsed())
          if (anyOpen) {
            if (sidebarPanel && !sidebarPanel.isCollapsed())
              sidebarPanel.collapse()
            if (chatPanel && !chatPanel.isCollapsed()) chatPanel.collapse()
          } else {
            if (sidebarPanel) sidebarPanel.expand()
            if (chatPanel) chatPanel.expand()
          }
          return
        }
        case "pan":
          e.preventDefault()
          return interaction.setSpaceHeld(true)
        // Delete/Backspace removes the selection (cascading selected groups to
        // their members) and selects what's next — the decision + apply both
        // live in the Canvas Selection controller. preventDefault only when
        // something was actually deleted.
        case "delete-selection":
          if (selection.deleteSelected()) e.preventDefault()
          return
        // ⌘D copies the selected frames and Mockups; the browser's own ⌘D
        // (bookmark) is kept only when nothing was copied.
        case "duplicate-selection":
          if (selection.duplicateSelected()) e.preventDefault()
          return
        case "undo":
          e.preventDefault()
          return history.undo()
        case "redo":
          e.preventDefault()
          return history.redo()
      }
    }
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === " ") {
        interaction.setSpaceHeld(false)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("keyup", handleKeyUp)
    return () => {
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("keyup", handleKeyUp)
    }
  }, [
    toolMode,
    selection,
    reference,
    targeting,
    history,
    interaction,
    sidebarPanelRef,
    chatPanelRef,
    zoom,
    openShortcutSheet,
    commentsPanel,
    readOnly,
  ])
}
