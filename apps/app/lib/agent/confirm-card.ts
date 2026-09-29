/**
 * The inline confirm card (#899, #901): the Coordinator's actions that need
 * the user's go-ahead first, opening a Workspace's PR and removing a
 * Workspace. Each is a plan-gated tool (`plan-gate.ts`) whose gate stores a
 * {@link ConfirmCard} with the pending plan; the chat draws it as a stock
 * Alert with the action's verb and Cancel instead of the plan card.
 *
 * Client-safe: the chat store and the history route both read the card off
 * the pending plan's stored input.
 */

export const OPEN_PULL_REQUEST_TOOL = "open_pull_request"
export const REMOVE_WORKSPACE_TOOL = "remove_workspace"

export type ConfirmAction =
  | typeof OPEN_PULL_REQUEST_TOOL
  | typeof REMOVE_WORKSPACE_TOOL

/** What the confirm card shows. */
export interface ConfirmCard {
  action: ConfirmAction
  /** The action as a question: "Open a pull request?". */
  title: string
  /** The target: branch into base and changed lines, or what goes. */
  description: string
  /** The primary button: the action's verb ("Open PR", "Remove"). */
  confirmLabel: string
}

/**
 * What a confirm gate keeps with its pending plan: the card, the Workspace it
 * acts on, and who asked (the Coordinator acts as the Workspace's owner on
 * GitHub, never as whoever confirms).
 */
export interface ConfirmGateInput {
  gate: ConfirmAction
  confirm: ConfirmCard
  workspaceId: string
  [key: string]: unknown
}

const ACTIONS: readonly string[] = [
  OPEN_PULL_REQUEST_TOOL,
  REMOVE_WORKSPACE_TOOL,
]

/** Whether a pending plan's stored input is a confirm gate's. */
export function isConfirmGateInput(
  input: Record<string, unknown> | null | undefined
): input is ConfirmGateInput {
  return (
    !!input &&
    typeof input.gate === "string" &&
    ACTIONS.includes(input.gate) &&
    typeof input.workspaceId === "string" &&
    confirmCardOf(input) !== null
  )
}

/** The confirm card a pending plan's stored input carries, if any. */
export function confirmCardOf(
  input: Record<string, unknown> | null | undefined
): ConfirmCard | null {
  const card = input?.confirm
  if (!card || typeof card !== "object" || Array.isArray(card)) return null
  const { action, title, description, confirmLabel } = card as Record<
    string,
    unknown
  >
  if (
    typeof action !== "string" ||
    !ACTIONS.includes(action) ||
    typeof title !== "string" ||
    typeof description !== "string" ||
    typeof confirmLabel !== "string"
  ) {
    return null
  }
  return {
    action: action as ConfirmAction,
    title,
    description,
    confirmLabel,
  }
}

/**
 * The continuation a decided confirm resumes the Coordinator with, as the
 * user's turn. The server acts itself on a confirm, so neither asks the
 * Coordinator to do anything; the recorded call carries the outcome.
 */
export function confirmResolutionText(approved: boolean): string {
  return approved ? "Confirmed." : "Cancelled."
}

/** The result recorded for a confirm the user cancelled. */
export function confirmCancelledResult(): string {
  return "Not done: the user cancelled it. Don't ask again unless they do."
}
