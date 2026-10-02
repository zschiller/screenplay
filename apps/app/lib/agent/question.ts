import type { AgentMessage } from "@/lib/agent/types"
import { bareToolName } from "@/lib/agent/tool-name"

/**
 * Question Cards (#1312): a chat asks the user a question with 2 to 4
 * options, the chat draws it as a card, and the option the user clicks comes
 * back as their next message. Nothing is stored beyond the tool call itself:
 * a card is answered once a user message follows it, and the option whose
 * label that message matches is the chosen one.
 *
 * Client-safe: the card and the tool share this module.
 */

export const ASK_QUESTION_TOOL = "ask_question"

export const MIN_QUESTION_OPTIONS = 2
export const MAX_QUESTION_OPTIONS = 4

export interface QuestionOption {
  label: string
  /** One line on what picking it means. */
  detail?: string
}

export interface Question {
  question: string
  options: QuestionOption[]
  /** Index into `options` of the one the chat recommends. */
  recommended?: number
}

type ToolCallMessage = Extract<AgentMessage, { role: "tool_call" }>

export function isQuestionCall(message: AgentMessage): boolean {
  return (
    message.role === "tool_call" &&
    bareToolName(message.title) === ASK_QUESTION_TOOL
  )
}

/**
 * A question call's arguments, or null while they're still streaming or when
 * they don't make a card (a harness may send anything).
 */
export function parseQuestion(input: unknown): Question | null {
  if (!input || typeof input !== "object") return null
  const raw = input as Record<string, unknown>
  const question = typeof raw.question === "string" ? raw.question.trim() : ""
  if (!question || !Array.isArray(raw.options)) return null
  const options: QuestionOption[] = []
  for (const option of raw.options) {
    const parsed = parseOption(option)
    if (parsed) options.push(parsed)
  }
  if (
    options.length < MIN_QUESTION_OPTIONS ||
    options.length > MAX_QUESTION_OPTIONS
  ) {
    return null
  }
  const recommended =
    typeof raw.recommended === "number" &&
    Number.isInteger(raw.recommended) &&
    raw.recommended >= 0 &&
    raw.recommended < options.length
      ? raw.recommended
      : undefined
  return { question, options, recommended }
}

function parseOption(option: unknown): QuestionOption | null {
  if (typeof option === "string") {
    const label = option.trim()
    return label ? { label } : null
  }
  if (!option || typeof option !== "object") return null
  const { label, detail } = option as Record<string, unknown>
  if (typeof label !== "string" || !label.trim()) return null
  const line = typeof detail === "string" ? detail.trim() : ""
  return line ? { label: label.trim(), detail: line } : { label: label.trim() }
}

/** What a card shows once it's been answered. */
export interface QuestionAnswer {
  /** The chosen option's index, or null when the reply was something else. */
  chosen: number | null
  /** The member who answered, by user id, when the server recorded one. */
  by?: string
}

/**
 * The answer to each question call in a transcript, by tool call id: the first
 * user message after the call, matched against its options. A Coordinator
 * wake (#897) is the server's message, not the user's, so it answers nothing.
 * A call no user message follows yet is left out: its card is still open.
 */
export function questionAnswers(
  messages: AgentMessage[]
): Map<string, QuestionAnswer> {
  const answers = new Map<string, QuestionAnswer>()
  let open: ToolCallMessage[] = []
  for (const message of messages) {
    if (message.role === "tool_call" && isQuestionCall(message)) {
      open.push(message)
    } else if (message.role === "user" && !message.wakeFrom) {
      for (const call of open) {
        answers.set(call.toolCallId, {
          chosen: chosenOption(parseQuestion(call.rawInput), message.content),
          // The Coordinator answered a Delegated Message, not its sender.
          ...(message.sentBy && !message.delegatedFrom
            ? { by: message.sentBy }
            : {}),
        })
      }
      open = []
    }
  }
  return answers
}

function chosenOption(question: Question | null, reply: string): number | null {
  if (!question) return null
  const text = normalize(reply)
  const index = question.options.findIndex(
    (option) => normalize(option.label) === text
  )
  return index === -1 ? null : index
}

function normalize(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase()
}
