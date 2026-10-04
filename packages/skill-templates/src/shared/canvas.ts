// Talking back to the chat when the page is a Mockup on a Screenplay canvas
// (#1641). The canvas inlines `window.screenplay` into every Mockup's page:
// `question()` hands the open question card its chat asked about this
// Mockup, `answer(index)` answers it as a click on the card would, and
// `draft(text)` fills the chat's composer. Both act only from a tap. Anywhere
// else (an Artifact, the dev server) none of it exists, and the page copies
// its reaction instead.

import * as React from "react"

/** The question card a page sees, as `screenplay.question()` hands it. */
export type CardQuestion = {
  id: string
  question: string
  options: { label: string; description?: string }[]
  recommended: number | null
  answer: { index: number } | null
}

type Runtime = {
  question?: (cb: (q: CardQuestion | null) => void) => CardQuestion | null
  answer?: (index: number) => boolean
  draft?: (text: string) => boolean
}

const runtime = (): Runtime | undefined =>
  (globalThis as { screenplay?: Runtime }).screenplay

/** Whether the page can draft into a chat: it's a Mockup on a canvas. */
export const onCanvas = () => !!runtime()?.draft

/** The open question card about this Mockup, live; null when there's none. */
export function useCardQuestion(): CardQuestion | null {
  const [q, setQ] = React.useState<CardQuestion | null>(null)
  React.useEffect(() => {
    // The runtime calls back at once and on every change, and has no unsubscribe
    let on = true
    runtime()?.question?.((next) => on && setQ(next))
    return () => {
      on = false
    }
  }, [])
  return q
}

/** Answers the card with option `index`; only works inside a tap. */
export const answerCard = (index: number) => !!runtime()?.answer?.(index)

/** Fills the chat's composer with `text`; only works inside a tap. */
export const draftToChat = (text: string) => !!runtime()?.draft?.(text)
