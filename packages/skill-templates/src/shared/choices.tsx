import * as React from "react"

import {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireItem,
} from "@workspace/ui/components/questionnaire"

import { Rec } from "./kit.tsx"

export type Choice = {
  value: string
  label: string
  detail?: string
  rec?: boolean
  /** A way out of the options (Skip, None of these): muted until chosen. */
  quiet?: boolean
}

/**
 * One question's options as the app's question card draws them (shadcn's
 * Questionnaire, one radio row each), so a call on the page reads like the
 * card the chat asks it with.
 */
export function Choices({
  name,
  choices,
  value,
  onChange,
}: {
  name: string
  choices: Choice[]
  value?: string
  onChange: (value: string) => void
}) {
  return (
    <Questionnaire onSubmit={(e) => e.preventDefault()} className="w-full">
      <QuestionnaireItem name={name} className="gap-1">
        <QuestionnaireChoices>
          {choices.map((c) => (
            <QuestionnaireChoice
              key={c.value}
              value={c.value}
              checked={value === c.value}
              onChange={() => onChange(c.value)}
            >
              <span
                className={
                  c.quiet && value !== c.value
                    ? "text-muted-foreground"
                    : undefined
                }
              >
                {c.label}
                {c.rec && <Rec className="ml-1.5 align-[1px]" />}
              </span>
              {c.detail && (
                <QuestionnaireChoiceDescription className="text-xs">
                  {c.detail}
                </QuestionnaireChoiceDescription>
              )}
            </QuestionnaireChoice>
          ))}
        </QuestionnaireChoices>
      </QuestionnaireItem>
    </Questionnaire>
  )
}
