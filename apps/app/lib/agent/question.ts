import type { AgentMessage } from "@/lib/agent/types"
import { bareToolName } from "@/lib/agent/tool-name"
import type { PageQuestion } from "@/lib/postmessage-protocol"

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
  /**
   * The Mockup the question is about (#1644): the card links to it, and the
   * page can answer it (`screenplay.answer`).
   */
  mockupId?: string
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
  const mockupId =
    typeof raw.mockup_id === "string" && raw.mockup_id.trim()
      ? raw.mockup_id.trim()
      : undefined
  return {
    question,
    options,
    recommended,
    ...(mockupId ? { mockupId } : {}),
  }
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

/** A transcript's latest question about one Mockup, and its answer. */
export interface MockupQuestion {
  toolCallId: string
  question: Question
  /** Absent while the card is still open. */
  answer?: QuestionAnswer
}

/**
 * The latest question a transcript asked about a Mockup (#1644), answered or
 * not, so the page can offer it and show its answer. Null when the chat never
 * asked one about it.
 */
export function mockupQuestion(
  messages: AgentMessage[],
  mockupId: string
): MockupQuestion | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== "tool_call" || !isQuestionCall(message)) continue
    const question = parseQuestion(message.rawInput)
    if (question?.mockupId !== mockupId) continue
    const answer = questionAnswers(messages.slice(i)).get(message.toolCallId)
    return {
      toolCallId: message.toolCallId,
      question,
      ...(answer ? { answer } : {}),
    }
  }
  return null
}

/** What the Mockup page sees of it (`screenplay.question()`). */
export function toPageQuestion(found: MockupQuestion): PageQuestion {
  const { question, answer } = found
  return {
    id: found.toolCallId,
    question: question.question,
    options: question.options.map((o) => ({ ...o })),
    recommended: question.recommended ?? null,
    answer: answer ? { index: answer.chosen } : null,
  }
}

/**
 * Whether a transcript ends on a question card still waiting for its answer:
 * a question call no user message follows, by the same rule as
 * {@link questionAnswers}. The chat then waits on a person, so its Workspace
 * needs you ("Question waiting", `lib/branch/workspace-state.ts`).
 */
export function hasOpenQuestion(messages: readonly AgentMessage[]): boolean {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role === "user" && !message.wakeFrom) return false
    if (isQuestionCall(message)) return true
  }
  return false
}
