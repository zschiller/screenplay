/**
 * Tool Mode — the React-free decision core for which draw tool is armed on the
 * canvas toolbar: Select, Frame, Document, or Comment.
 *
 * These four were previously three independent booleans (`documentMode`,
 * `frameMode`, `commentMode`) with "Select" being the implicit none-active
 * state, so every toolbar button and keyboard shortcut had to hand-clear the
 * other modes ("set the other three to false") to keep them mutually exclusive.
 * Modelling them as one discriminated value makes "exactly one tool active"
 * hold *by construction*: there is one {@link ToolMode}, never three flags.
 *
 * {@link reduceToolMode} is the pure transition the controller (`useToolMode`)
 * and the keyboard handler both dispatch into — pinned by fixtures the same way
 * the other lib/canvas cores are.
 *
 * Out of scope (deliberately): Focus mode and Create-Flow mode stay in
 * `interaction-mode` — they govern frame interaction, not draw-tool selection —
 * and the comment-placement sub-state (new-comment position, inspect hover)
 * stays in the component. Tool Mode only arms *which tool* is active.
 */

/** The single active draw tool. "select" is the resting / pointer tool. */
export type ToolMode = "select" | "frame" | "comment" | "document"

/** The four armable tools (everything but the resting "select" state). */
export type ToolModeTool = Exclude<ToolMode, "select">

/**
 * A Tool Mode transition request:
 *  - `set` arms a specific mode unconditionally (the Select button / `V` key,
 *    or an Escape that exits the active tool back to Select).
 *  - `toggle` arms a tool, or returns to Select if it is already active — the
 *    behavior of pressing a tool's button or its single-letter shortcut twice.
 */
export type ToolModeEvent =
  | { type: "set"; mode: ToolMode }
  | { type: "toggle"; tool: ToolModeTool }

/**
 * Reduce the current Tool Mode against an event. A `set` is absolute; a
 * `toggle` flips the named tool against Select. Mutual exclusion is automatic —
 * the result is a single mode value, so two tools can never be active at once.
 */
export function reduceToolMode(
  current: ToolMode,
  event: ToolModeEvent
): ToolMode {
  switch (event.type) {
    case "set":
      return event.mode
    case "toggle":
      return current === event.tool ? "select" : event.tool
  }
}
