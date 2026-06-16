import { type RefObject, useEffect } from "react"
import { type PanelImperativeHandle } from "react-resizable-panels"

import type { CanvasInteraction } from "@/components/canvas/use-canvas-interaction"
import type { CanvasSelection } from "@/components/canvas/use-canvas-selection"
import type { ElementReference } from "@/components/canvas/use-element-reference"
import type { ToolModeController } from "@/components/canvas/use-tool-mode"

/**
 * Canvas Keyboard controller (PRD #579, cut 4/4) — the single home for the
 * global `keydown`/`keyup` shortcut dispatch, lifted out of the Canvas
 * composition root where it was the largest effect in the file (~190 lines).
 *
 * Sequenced last so it consumes the controllers the earlier cuts bundled (Tool
 * Mode, Canvas Selection, Element Reference, the Yjs history) rather than the
 * loose setters they replaced. The controller owns the window listeners and the
 * shortcut map; it dispatches into the controllers, panel refs, cursor-chat
 * verbs, and focus / Create-Flow setters it is handed.
 *
 * The Escape *precedence* stays in the React-free `resolveEscapeAction`, wrapped
 * by the Canvas Interaction controller's `resolveEscape` (over
 * `lib/canvas/escape.ts`, pinned by `escape.test.ts`); this controller only
 * applies the chosen exit. No shortcut semantics change from the lift — every
 * shortcut (Escape exits, `v`/`c`/`d`/`f` tools, `/` cursor chat, ⌘B / ⌘I / ⌘.
 * panel toggles, Delete/Backspace, ⌘Z / ⌘⇧Z undo/redo, space-pan) behaves
 * exactly as before, including the `isEditing` guard that suppresses shortcuts
 * inside inputs / textareas / contenteditable.
 */
export interface CanvasKeyboardInputs {
  /** Tool Mode controller — the `/`-resolver source plus the tool dispatches. */
  toolMode: ToolModeController
  /** Canvas Selection controller — Escape's clear and Delete/Backspace. */
  selection: CanvasSelection
  /** Element Reference controller — comment-mode placement read + clear. */
  reference: ElementReference
  /** Yjs undo/redo, scoped to room storage. */
  history: { undo: () => void; redo: () => void }
  /**
   * Canvas Interaction controller — owns the Focus / Create-Flow / editing /
   * space-held / cursor-chat state. Escape dispatches on its `resolveEscape`
   * and applies the mode/edit/cursor-chat exits through its verbs; `/` opens
   * cursor chat and space toggles its pan flag.
   */
  interaction: CanvasInteraction
  /** Side panels toggled by ⌘B (sidebar), ⌘I (chat), and ⌘. (both). */
  sidebarPanelRef: RefObject<PanelImperativeHandle | null>
  chatPanelRef: RefObject<PanelImperativeHandle | null>
}

export function useCanvasKeyboard({
  toolMode,
  selection,
  reference,
  history,
  interaction,
  sidebarPanelRef,
  chatPanelRef,
}: CanvasKeyboardInputs): void {
  useEffect(() => {
    const isEditing = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        (e.target as HTMLElement)?.isContentEditable
      )
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Precedence (innermost/most-transient first) lives in the React-free
        // `resolveEscapeAction`, wrapped by the Interaction controller's
        // `resolveEscape` (it fills its own state, the caller passes the
        // tool/comment bits); this switch just applies the chosen exit. The
        // focus / Create Flow steps are the two manual mode exits pinned by
        // lib/canvas/escape.test.ts.
        switch (
          interaction.resolveEscape({
            toolMode: toolMode.current(),
            hasNewCommentPos: reference.newCommentPos !== null,
          })
        ) {
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
            toolMode.set("select")
            break
          case "exit-comment-mode":
            toolMode.set("select")
            reference.clearMode()
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
      }
      // The four draw-tool shortcuts each dispatch one Tool Mode intent; the
      // union keeps the tools mutually exclusive, so there's no "clear the other
      // three" to do here. Resetting the comment-placement sub-state stays.
      if (e.key === "v" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        toolMode.set("select")
        reference.clearMode()
      }
      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        toolMode.toggle("comment")
        reference.clearMode()
      }
      if (e.key === "d" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        toolMode.toggle("document")
        reference.clearMode()
      }
      if (e.key === "f" && !e.metaKey && !e.ctrlKey && !isEditing(e)) {
        toolMode.toggle("frame")
        reference.clearMode()
      }
      // Figma-style cursor chat. Opens an inline input next to the cursor and
      // broadcasts each keystroke through awareness so peers see the message
      // floating beside the user's remote cursor.
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isEditing(e) &&
        !interaction.isCursorChatOpen()
      ) {
        e.preventDefault()
        interaction.openCursorChat()
      }
      if (e.key === "b" && e.metaKey && !e.altKey) {
        e.preventDefault()
        const panel = sidebarPanelRef.current
        if (panel) {
          if (panel.isCollapsed()) panel.expand()
          else panel.collapse()
        }
      }
      if (
        (e.key === "i" || e.key === "I") &&
        e.metaKey &&
        !e.altKey &&
        !e.ctrlKey &&
        !isEditing(e)
      ) {
        e.preventDefault()
        const panel = chatPanelRef.current
        if (panel) {
          if (panel.isCollapsed()) panel.expand()
          else panel.collapse()
        }
      }
      // Toggle both side panels: Cmd+.
      if (
        e.key === "." &&
        e.metaKey &&
        !e.altKey &&
        !e.ctrlKey &&
        !e.shiftKey
      ) {
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
      }
      if (e.key === " " && !e.repeat) {
        if (!isEditing(e)) {
          e.preventDefault()
          interaction.setSpaceHeld(true)
        }
      }
      // Delete/Backspace removes the selection (cascading selected groups to
      // their members) and selects what's next — the decision + apply both live
      // in the Canvas Selection controller, which reads its own current
      // selection. preventDefault only when something was actually deleted.
      if ((e.key === "Delete" || e.key === "Backspace") && !isEditing(e)) {
        if (selection.deleteSelected()) e.preventDefault()
      }
      // Undo: Cmd/Ctrl+Z
      if (
        e.key === "z" &&
        (e.metaKey || e.ctrlKey) &&
        !e.shiftKey &&
        !isEditing(e)
      ) {
        e.preventDefault()
        history.undo()
      }
      // Redo: Cmd/Ctrl+Shift+Z
      if (
        e.key === "z" &&
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        !isEditing(e)
      ) {
        e.preventDefault()
        history.redo()
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
    history,
    interaction,
    sidebarPanelRef,
    chatPanelRef,
  ])
}
