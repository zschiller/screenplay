/**
 * The single action the Escape key takes on the canvas, resolved from the
 * current interaction state.
 *
 * Escape walks a fixed precedence and clears exactly one thing: the innermost,
 * most transient interaction wins. Two of those steps are the *manual exits*
 * from interaction mode — leaving focus ("interactive") mode and leaving Create
 * Flow ("flow") mode — which this module exists to pin down. Extracting the
 * decision here (React-free, per ADR 0001) lets the precedence, and especially
 * those two mode exits, be asserted as observable behavior — bare state in, the
 * resulting action out — rather than against the canvas component's wiring.
 */
export type EscapeAction =
  | "close-cursor-chat"
  | "stop-editing-document"
  | "exit-document-mode"
  | "exit-frame-mode"
  | "exit-comment-mode"
  | "exit-focus-mode"
  | "exit-create-flow-mode"
  | "clear-selection"

/**
 * The slice of canvas interaction state Escape reads, as bare data: booleans
 * and nullable ids, no React. Mirrors the precedence the canvas keyboard
 * handler applies, top (most transient) to bottom.
 */
export interface EscapeState {
  /** A Figma-style cursor-chat message is open. */
  cursorChatOpen: boolean
  /** A Markdown Layer is being edited inline. */
  editingDocumentLayerId: string | null
  /** Document-placement mode is active. */
  documentMode: boolean
  /** Frame-placement mode is active. */
  frameMode: boolean
  /** Comment mode is active. */
  commentMode: boolean
  /** A new comment position is staged. */
  hasNewCommentPos: boolean
  /** The focused ("interactive") Iframe Layer, or null when not focused. */
  focusedIframeLayerId: string | null
  /** The Iframe Layer in Create Flow ("flow") mode, or null. */
  createFlowIframeLayerId: string | null
}

/**
 * Resolve the one action Escape takes for a given interaction state. The order
 * of the checks *is* the precedence: a cursor-chat dismiss outranks leaving a
 * mode, leaving a mode outranks clearing the selection, and so on. With nothing
 * else active, a focused frame exits focus mode and a Create Flow frame exits
 * Create Flow mode; with neither, Escape clears the selection.
 */
export function resolveEscapeAction(state: EscapeState): EscapeAction {
  if (state.cursorChatOpen) return "close-cursor-chat"
  if (state.editingDocumentLayerId) return "stop-editing-document"
  if (state.documentMode) return "exit-document-mode"
  if (state.frameMode) return "exit-frame-mode"
  if (state.commentMode || state.hasNewCommentPos) return "exit-comment-mode"
  if (state.focusedIframeLayerId) return "exit-focus-mode"
  if (state.createFlowIframeLayerId) return "exit-create-flow-mode"
  return "clear-selection"
}
