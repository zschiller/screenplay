import type { AgentMessage } from "@/lib/agent/types"
import {
  parseTargetedElementsFooter,
  parseUserMessage,
  type TargetedElement,
} from "@/lib/agent/message-markers"

/**
 * User-turn projection (#1246): the one place a user turn's wire text (as
 * persisted, or as echoed live) becomes what the chat shows. The body loses
 * the server prefixes and both footers; whether the turn is a Coordinator
 * wake or a Delegated Message, and its targeted elements, become typed
 * fields, so the UI reads them instead of parsing marker strings, and a
 * reloaded chat looks the way the live one did.
 *
 * Inline `[skill: …]`, `[@…](mention:…)` and `[element: …](element:…)` tokens
 * stay in the body for the renderer's pills. Isomorphic: the history route
 * and the chat store both run it.
 */
export interface UserTurn {
  /** The text the user message view draws. */
  body: string
  /** The Workspace whose turn ended, when this is a Coordinator wake. */
  wakeFrom?: string
  /** The sending Coordinator chat, when this is a Delegated Message. */
  delegatedFrom?: string
  /** The `Targeted elements:` footer's entries, keyed by their inline ref. */
  targetedElements?: TargetedElement[]
}

export function projectUserTurn(wire: string): UserTurn {
  const { body, wakeFrom, delegatedFrom } = parseUserMessage(wire)
  const targetedElements = parseTargetedElementsFooter(wire)
  return {
    body,
    ...(wakeFrom ? { wakeFrom } : {}),
    ...(delegatedFrom ? { delegatedFrom } : {}),
    ...(targetedElements.length > 0 ? { targetedElements } : {}),
  }
}

/** A user turn's wire text as the chat message the UI draws. */
export function userTurnMessage(
  wire: string
): Extract<AgentMessage, { role: "user" }> {
  const { body, ...fields } = projectUserTurn(wire)
  return { role: "user", content: body, ...fields }
}
