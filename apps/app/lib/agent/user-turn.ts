import type { AgentMessage } from "@/lib/agent/types"
import {
  isUpdate,
  textBlock,
  blockText,
  type SessionUpdate,
} from "@/lib/agent/acp/schema"
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
 * stay in the body for the renderer's pills. The server runs it: the history
 * route on reload, and Turn Launch and the Steer path on the live echo
 * ({@link userTurnEcho}). The browser only reads its output back
 * ({@link echoedUserTurn}), so no UI module parses marker strings.
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

/** A user message as the chat draws it. */
export type UserTurnMessage = Extract<AgentMessage, { role: "user" }>

/** A projected user turn as the chat message the UI draws. */
export function userTurnToMessage({
  body,
  ...fields
}: UserTurn): UserTurnMessage {
  return { role: "user", content: body, ...fields }
}

/** A user turn's wire text as the chat message the UI draws. */
export function userTurnMessage(wire: string): UserTurnMessage {
  return userTurnToMessage(projectUserTurn(wire))
}

/** Where a live echo carries the projection's typed fields. */
const ECHO_META_KEY = "screenplayUserTurn"

type EchoFields = Omit<UserTurn, "body">

/**
 * The live echo of a user turn (ADR 0006): an ACP `user_message_chunk` whose
 * text is the projected body, with the typed fields in its `_meta`. Every
 * client appends it as-is, so the live message is the one a reload draws.
 */
export function userTurnEcho(wire: string): SessionUpdate {
  const { body, ...fields } = projectUserTurn(wire)
  return {
    sessionUpdate: "user_message_chunk",
    content: textBlock(body),
    ...(Object.keys(fields).length > 0
      ? { _meta: { [ECHO_META_KEY]: fields satisfies EchoFields } }
      : {}),
  }
}

/** Read a {@link userTurnEcho} back into the message it shows. */
export function echoedUserTurn(update: SessionUpdate): UserTurnMessage | null {
  if (!isUpdate(update, "user_message_chunk")) return null
  const fields = update._meta?.[ECHO_META_KEY] as EchoFields | undefined
  return userTurnToMessage({ body: blockText(update.content), ...fields })
}
