import type { AgentMessage } from "@/lib/agent/types"
import type { AcpMessageRecord } from "@/lib/agent/acp/record"
import {
  isUpdate,
  textBlock,
  blockText,
  type SessionUpdate,
} from "@/lib/agent/acp/schema"
import {
  parseAttachmentsFooter,
  parseTargetedElementsFooter,
  parseUserMessage,
  type MessageAttachment,
  type PrEventMark,
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
  /** What happened to the chat's PR, when this is a PR event (#1702). */
  prEvent?: PrEventMark
  /** The Workspace whose turn ended, when this is a Coordinator wake. */
  wakeFrom?: string
  /** The sending Coordinator chat, when this is a Delegated Message. */
  delegatedFrom?: string
  /** The `Targeted elements:` footer's entries, keyed by their inline ref. */
  targetedElements?: TargetedElement[]
  /** The files attached to it (#1525), from its `Attached files:` footer. */
  attachments?: MessageAttachment[]
  /**
   * The member who sent it, by user id. Not in the wire text: the server
   * records it beside the turn (the stored record's `sentBy`, the send's
   * session) and hands it in.
   */
  sentBy?: string
}

export function projectUserTurn(
  wire: string,
  sentBy?: string | null
): UserTurn {
  const { body, prEvent, wakeFrom, delegatedFrom } = parseUserMessage(wire)
  const targetedElements = parseTargetedElementsFooter(wire)
  const attachments = parseAttachmentsFooter(wire)
  return {
    body,
    ...(prEvent ? { prEvent } : {}),
    ...(wakeFrom ? { wakeFrom } : {}),
    ...(delegatedFrom ? { delegatedFrom } : {}),
    ...(targetedElements.length > 0 ? { targetedElements } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(sentBy ? { sentBy } : {}),
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
export function userTurnMessage(
  wire: string,
  sentBy?: string | null
): UserTurnMessage {
  return userTurnToMessage(projectUserTurn(wire, sentBy))
}

/** Where a live echo carries the projection's typed fields. */
const ECHO_META_KEY = "screenplayUserTurn"

type EchoFields = Omit<UserTurn, "body">

/**
 * The live echo of a user turn (ADR 0006): an ACP `user_message_chunk` whose
 * text is the projected body, with the typed fields in its `_meta`. Every
 * client appends it as-is, so the live message is the one a reload draws.
 */
export function userTurnEcho(
  wire: string,
  sentBy?: string | null
): SessionUpdate {
  const { body, ...fields } = projectUserTurn(wire, sentBy)
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

/** Whether a saved user record is a PR event (#1702) rather than a message. */
function isPrEventRecord(record: AcpMessageRecord): boolean {
  if (record.role !== "user") return false
  return !!parseUserMessage(record.content.map(blockText).join("")).prEvent
}

/**
 * The history with the message that started this turn last. A PR event saved
 * while a turn was starting can land after that message, and the newest user
 * record is the turn's prompt, so PR events at the end move ahead of the
 * messages around them. A history that ends in a PR event alone keeps it as
 * the prompt.
 */
export function withPromptLast(
  history: AcpMessageRecord[]
): AcpMessageRecord[] {
  let start = history.length
  while (start > 0 && history[start - 1]!.role === "user") start--
  const tail = history.slice(start)
  const events = tail.filter(isPrEventRecord)
  if (events.length === 0 || events.length === tail.length) return history
  const rest = tail.filter((r) => !isPrEventRecord(r))
  if (tail.at(-1) === rest.at(-1)) return history
  return [...history.slice(0, start), ...events, ...rest]
}
