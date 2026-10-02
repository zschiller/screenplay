"use client"

import { useState } from "react"
import { Badge } from "@workspace/ui/components/badge"
import {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireItem,
  QuestionnaireTitle,
} from "@workspace/ui/components/questionnaire"
import type { AgentMessage } from "@/lib/agent/types"
import { inputStore } from "@/lib/input-store"
import { parseQuestion, type QuestionAnswer } from "@/lib/agent/question"

/**
 * A chat's question (#1312), drawn with shadcn's Questionnaire: one item, a
 * radio choice per option. Picking one sends its label as the user's next
 * message, through the chat's own composer path (so it steers or queues like
 * anything typed); there is no Next or Submit, since one question needs none.
 * Once a user message follows the call, the card is answered: the chosen
 * option stays checked and the others are disabled, and on a shared Canvas
 * the card names who answered.
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
    inputStore.send(chatId, question.options[index]!.label)
  }

  return (
    <Questionnaire
      data-testid="question-card"
      onSubmit={(e) => e.preventDefault()}
    >
      {/* Choices are disabled one by one: a disabled Item counts as
          skipped, and the Questionnaire hides it. */}
      <QuestionnaireItem name={`question-${message.toolCallId}`}>
        {/* The chat's type scale: the question reads as body text. */}
        <QuestionnaireTitle className="text-sm">
          {question.question}
        </QuestionnaireTitle>
        <QuestionnaireChoices>
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
      </QuestionnaireItem>
    </Questionnaire>
  )
}
