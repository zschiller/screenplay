"use client"

import { useState, type KeyboardEvent } from "react"
import { Badge } from "@workspace/ui/components/badge"
import {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireItem,
  QuestionnaireTitle,
} from "@workspace/ui/components/questionnaire"
import type { AgentMessage } from "@/lib/agent/types"
import { inputStore } from "@/lib/input-store"
import { parseQuestion, type QuestionAnswer } from "@/lib/agent/question"
import { viewRequests } from "@/lib/canvas/view-requests"
import { useMockupTitle } from "@/lib/yjs/react"
import { InlineRef } from "./inline-ref"

/**
 * A chat's question (#1312), drawn with shadcn's Questionnaire: one item, a
 * radio choice per option. Picking one sends its label as the user's next
 * message, through the chat's own composer path (so it steers or queues like
 * anything typed); there is no Next or Submit, since one question needs none.
 * Once a user message follows the call, the card is answered: the chosen
 * option stays checked and the others are disabled, and on a shared Canvas
 * the card names who answered.
 *
 * Only a click, Space or Enter answers. Arrow keys move between choices
 * without picking: a native radio group checks the choice it moves to, which
 * here would send it.
 *
 * A question about a Mockup (#1644) names it under the question, and the name
 * brings it into view. Its page can answer the question too, sending the same
 * message a click here does, so the card shows that answer like any other.
 *
 * Returns null while the call's arguments are still streaming, or when they
 * don't make a question, so the chat shows the plain tool row instead.
 */
export function QuestionCard({
  message,
  chatId,
  answer,
  answeredBy,
}: {
  message: AgentMessage & { role: "tool_call" }
  chatId?: string
  answer?: QuestionAnswer
  /** Who answered it, on a shared Canvas. */
  answeredBy?: string
}) {
  // Picked here but not yet in the transcript: holds the card shut until the
  // sent message lands, so a second pick can't send a second answer.
  const [sent, setSent] = useState<number | null>(null)
  const question = parseQuestion(message.rawInput)
  if (!question) return null

  const answered = answer != null || sent != null
  const chosen = answer ? answer.chosen : sent

  const pick = (index: number) => {
    if (answered || !chatId) return
    setSent(index)
    // A refused send holds its text in the chat for Retry; the card opens
    // again so a pick can be made here.
    void inputStore.send(chatId, question.options[index]!.label).then((ok) => {
      if (!ok) setSent(null)
    })
  }

  // On the choices, so it runs before the Questionnaire's own keys on the
  // form, which skip a key handled here.
  const onChoicesKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // One radio per option, in order.
    const radios = Array.from(
      e.currentTarget.querySelectorAll<HTMLInputElement>("input[type=radio]")
    )
    const index = radios.indexOf(e.target as HTMLInputElement)
    if (index < 0) return
    if (e.key === "Enter") {
      e.preventDefault()
      if (!e.repeat) pick(index)
      return
    }
    const inputs = radios.filter((r) => !r.disabled)
    const at = inputs.indexOf(radios[index]!)
    if (at < 0) return
    const step =
      e.key === "ArrowDown" || e.key === "ArrowRight"
        ? 1
        : e.key === "ArrowUp" || e.key === "ArrowLeft"
          ? -1
          : 0
    if (!step) return
    e.preventDefault()
    inputs[(at + step + inputs.length) % inputs.length]!.focus()
  }

  return (
    <Questionnaire
      data-testid="question-card"
      onSubmit={(e) => e.preventDefault()}
    >
      {/* Choices are disabled one by one: a disabled Item counts as
          skipped, and the Questionnaire hides it. */}
      <QuestionnaireItem name={`question-${message.toolCallId}`}>
        {/* The question sits on the chat, so it reads as the reply around it. */}
        <QuestionnaireTitle className="text-prose">
          {question.question}
        </QuestionnaireTitle>
        {question.mockupId && <MockupLine id={question.mockupId} />}
        {/* The answer line sits as close under the choices as a sender's
            name sits over their message. */}
        <div className="flex flex-col gap-1">
          <QuestionnaireChoices onKeyDown={onChoicesKeyDown}>
            {question.options.map((option, i) => (
              <QuestionnaireChoice
                key={i}
                value={option.label}
                checked={chosen === i}
                // The chosen one stays at full strength; picking it again
                // sends nothing (see `pick`).
                disabled={!chatId || (answered && chosen !== i)}
                onChange={() => pick(i)}
              >
                <span className="flex items-center gap-1.5">
                  {option.label}
                  {question.recommended === i && (
                    <Badge variant="outline">Recommended</Badge>
                  )}
                </span>
                {option.detail && (
                  <QuestionnaireChoiceDescription className="text-xs">
                    {option.detail}
                  </QuestionnaireChoiceDescription>
                )}
              </QuestionnaireChoice>
            ))}
          </QuestionnaireChoices>
          {answered && (chosen == null || answeredBy) && (
            <p
              data-testid="question-answered-by"
              className="text-xs text-muted-foreground"
            >
              {chosen == null
                ? answeredBy
                  ? `${answeredBy} answered in chat`
                  : "Answered in chat"
                : `Answered by ${answeredBy}`}
            </p>
          )}
        </div>
      </QuestionnaireItem>
    </Questionnaire>
  )
}

/**
 * The Mockup a question is about, as a reference under the question that
 * brings it into view. Gone when the Mockup is.
 */
function MockupLine({ id }: { id: string }) {
  const title = useMockupTitle(id)
  if (title === undefined) return null
  return (
    // 4px under the question (a legend, outside the Item's gap), and the
    // Item's 16px over the choices, as the question has without it.
    <QuestionnaireDescription
      data-testid="question-mockup"
      className="mt-1 text-xs"
    >
      On{" "}
      <InlineRef kind="mockup" onClick={() => viewRequests.emit({ ids: [id] })}>
        {title || "Mockup"}
      </InlineRef>
    </QuestionnaireDescription>
  )
}
