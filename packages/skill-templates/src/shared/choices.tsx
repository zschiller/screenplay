import * as React from "react"

import { Badge } from "@workspace/ui/components/badge"
import {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireItem,
} from "@workspace/ui/components/questionnaire"

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
    <Questionnaire
      onSubmit={(e) => e.preventDefault()}
      className="max-w-[72ch]"
    >
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
                {c.rec && (
                  <Badge variant="outline" className="ml-1.5 align-[1px]">
                    Recommended
                  </Badge>
                )}
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

/**
 * Edge fades for a row that scrolls sideways (filter tabs): the side that
 * hides items fades out, as the exploration page's round row does.
 */
export function useEdgeFade<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)
  const [edges, setEdges] = React.useState({ less: false, more: false })
  const fit = React.useCallback(() => {
    const t = ref.current
    if (!t) return
    setEdges({
      more: t.scrollWidth - t.scrollLeft > t.clientWidth + 1,
      less: t.scrollLeft > 1,
    })
  }, [])
  React.useLayoutEffect(() => {
    fit()
    addEventListener("resize", fit)
    return () => removeEventListener("resize", fit)
  }, [fit])
  const mask =
    edges.less && edges.more
      ? "linear-gradient(90deg,transparent,#000 40px calc(100% - 40px),transparent)"
      : edges.less
        ? "linear-gradient(90deg,transparent,#000 40px)"
        : edges.more
          ? "linear-gradient(90deg,#000 calc(100% - 40px),transparent)"
          : undefined
  return {
    ref,
    onScroll: fit,
    style: { maskImage: mask, WebkitMaskImage: mask },
  }
}
