import { type RefObject, useEffect } from "react"
import { type PanelImperativeHandle } from "react-resizable-panels"

import { resolveEscapeAction } from "@/lib/canvas/escape"
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
 * The Escape *precedence* stays in the React-free `resolveEscapeAction`
 * (`lib/canvas/escape.ts`, pinned by `escape.test.ts`); this controller only
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
  /** The focused ("interactive") Iframe Layer, read by the Escape resolver. */
  focusedIframeLayerId: string | null
  setFocusedIframeLayerId: (id: string | null) => void
  /** The Iframe Layer in Create Flow ("flow") mode, read by the resolver. */
  createFlowIframeLayerId: string | null
  setCreateFlowIframeLayerId: (id: string | null) => void
  /**
   * Latest inline-edited Markdown Layer id, mirrored into a ref so the
   * long-lived handler reads it without re-binding. Escape stops the edit.
   */
  editingDocumentLayerIdRef: RefObject<string | null>
  setEditingDocumentLayerId: (id: string | null) => void
  /**
   * Latest self cursor-chat message (null = closed), mirrored into a ref for
   * the same reason — it changes on every keystroke broadcast through awareness.
   */
  cursorChatMessageRef: RefObject<string | null>
  /** Cursor-chat verbs — `/` opens, Escape closes. */
  openCursorChat: () => void
  closeCursorChat: () => void
  /** Side panels toggled by ⌘B (sidebar), ⌘I (chat), and ⌘. (both). */
  sidebarPanelRef: RefObject<PanelImperativeHandle | null>
  chatPanelRef: RefObject<PanelImperativeHandle | null>
  /** Space-pan: held while the space bar is down. */
  setSpaceHeld: (held: boolean) => void
}

export function useCanvasKeyboard({
  toolMode,
  selection,
  reference,
  history,
  focusedIframeLayerId,
  setFocusedIframeLayerId,
  createFlowIframeLayerId,
  setCreateFlowIframeLayerId,
  editingDocumentLayerIdRef,
  setEditingDocumentLayerId,
  cursorChatMessageRef,
  openCursorChat,
  closeCursorChat,
  sidebarPanelRef,
  chatPanelRef,
  setSpaceHeld,
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
        // `resolveEscapeAction`; this switch just applies the chosen exit. The
        // focus / Create Flow steps are the two manual mode exits pinned by
        // lib/canvas/escape.test.ts.
        switch (
          resolveEscapeAction({
            cursorChatOpen: cursorChatMessageRef.current !== null,
            editingDocumentLayerId: editingDocumentLayerIdRef.current,
            toolMode: toolMode.current(),
            hasNewCommentPos: reference.newCommentPos !== null,
            focusedIframeLayerId,
            createFlowIframeLayerId,
          })
        ) {
          case "close-cursor-chat":
            closeCursorChat()
            break
          case "stop-editing-document":
            setEditingDocumentLayerId(null)
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
            setFocusedIframeLayerId(null)
            break
          case "exit-create-flow-mode":
            setCreateFlowIframeLayerId(null)
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
        cursorChatMessageRef.current === null
      ) {
        e.preventDefault()
        openCursorChat()
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
          setSpaceHeld(true)
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
        setSpaceHeld(false)
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
    focusedIframeLayerId,
    createFlowIframeLayerId,
    history,
    openCursorChat,
    closeCursorChat,
    editingDocumentLayerIdRef,
    setEditingDocumentLayerId,
    cursorChatMessageRef,
    setFocusedIframeLayerId,
    setCreateFlowIframeLayerId,
    sidebarPanelRef,
    chatPanelRef,
    setSpaceHeld,
  ])
}
