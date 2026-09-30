import { describe, expect, it } from "vitest"

import { type EscapeState, resolveEscapeAction } from "@/lib/canvas/escape"

// Plain fixtures — no React, no Y.Doc. `resolveEscapeAction` is pure: bare
// interaction state in, the single action Escape takes out. These lock in the
// two existing *manual exits* from interaction mode (focus and Create Flow) so
// the keyboard path and any future auto-reconciliation of these ids stay
// consistent. We assert observable behavior (the mode is exited), never how the
// canvas component is wired.

/** A neutral state: nothing active, so Escape would only clear the selection. */
function idleState(overrides: Partial<EscapeState> = {}): EscapeState {
  return {
    targetPickActive: false,
    cursorChatOpen: false,
    editingDocumentLayerId: null,
    toolMode: "select",
    hasNewCommentPos: false,
    commentsPanelOpen: false,
    focusedIframeLayerId: null,
    createFlowIframeLayerId: null,
    ...overrides,
  }
}

describe("resolveEscapeAction — manual mode exits", () => {
  it("exits focus mode when a frame is focused and nothing higher-priority is active", () => {
    const action = resolveEscapeAction(
      idleState({ focusedIframeLayerId: "frame-1" })
    )

    expect(action).toBe("exit-focus-mode")
  })

  it("exits Create Flow mode when a frame is in flow mode and nothing higher-priority is active", () => {
    const action = resolveEscapeAction(
      idleState({ createFlowIframeLayerId: "frame-1" })
    )

    expect(action).toBe("exit-create-flow-mode")
  })

  it("clears the selection when no mode is active", () => {
    expect(resolveEscapeAction(idleState())).toBe("clear-selection")
  })
})

describe("resolveEscapeAction — precedence", () => {
  // The cascade is fixed: the innermost / most transient interaction wins, so a
  // single Escape only ever steps out one level. These pin that the two mode
  // exits sit *below* the transient surfaces (cursor chat, inline editing,
  // document/frame placement, comment mode) and *above* the bare selection.

  it("cancels an armed element pick before anything else", () => {
    // The pick is modal: one Escape abandons it without also closing cursor
    // chat, leaving a draw tool, or clearing the selection underneath it.
    const action = resolveEscapeAction(
      idleState({
        targetPickActive: true,
        cursorChatOpen: true,
        editingDocumentLayerId: "doc-1",
        toolMode: "comment",
        focusedIframeLayerId: "frame-1",
      })
    )

    expect(action).toBe("cancel-target-pick")
  })

  it("dismisses cursor chat before exiting any mode", () => {
    const action = resolveEscapeAction(
      idleState({
        cursorChatOpen: true,
        focusedIframeLayerId: "frame-1",
        createFlowIframeLayerId: "frame-1",
      })
    )

    expect(action).toBe("close-cursor-chat")
  })

  it("stops inline document editing before exiting focus mode", () => {
    const action = resolveEscapeAction(
      idleState({
        editingDocumentLayerId: "doc-1",
        focusedIframeLayerId: "frame-1",
      })
    )

    expect(action).toBe("stop-editing-document")
  })

  it("exits document mode before focus mode", () => {
    const action = resolveEscapeAction(
      idleState({ toolMode: "document", focusedIframeLayerId: "frame-1" })
    )

    expect(action).toBe("exit-document-mode")
  })

  it("exits frame mode before focus mode", () => {
    const action = resolveEscapeAction(
      idleState({ toolMode: "frame", focusedIframeLayerId: "frame-1" })
    )

    expect(action).toBe("exit-frame-mode")
  })

  it("exits comment mode (active tool) before focus mode", () => {
    const action = resolveEscapeAction(
      idleState({ toolMode: "comment", focusedIframeLayerId: "frame-1" })
    )

    expect(action).toBe("exit-comment-mode")
  })

  it("exits comment mode (staged new-comment position) before focus mode", () => {
    const action = resolveEscapeAction(
      idleState({ hasNewCommentPos: true, focusedIframeLayerId: "frame-1" })
    )

    expect(action).toBe("exit-comment-mode")
  })

  it("closes the Comments panel before leaving focus mode or clearing the selection", () => {
    expect(
      resolveEscapeAction(
        idleState({ commentsPanelOpen: true, focusedIframeLayerId: "frame-1" })
      )
    ).toBe("close-comments-panel")
    expect(resolveEscapeAction(idleState({ commentsPanelOpen: true }))).toBe(
      "close-comments-panel"
    )
  })

  it("leaves the Comment tool before closing the Comments panel", () => {
    const action = resolveEscapeAction(
      idleState({ toolMode: "comment", commentsPanelOpen: true })
    )

    expect(action).toBe("exit-comment-mode")
  })

  it("exits focus mode before Create Flow mode when (defensively) both are set", () => {
    // Focus and Create Flow are mutually exclusive in practice, but the
    // precedence is still defined: focus wins, so one Escape can never leave
    // both modes dangling in a single step.
    const action = resolveEscapeAction(
      idleState({
        focusedIframeLayerId: "frame-1",
        createFlowIframeLayerId: "frame-2",
      })
    )

    expect(action).toBe("exit-focus-mode")
  })
})
