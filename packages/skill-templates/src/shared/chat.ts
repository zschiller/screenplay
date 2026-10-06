import * as React from "react"

// On a Screenplay canvas the page is a Mockup, and the canvas gives it
// `screenplay.draft` (#1645) and `screenplay.question` (#1644). Published as
// an Artifact it has neither, and the page copies. A pick never answers the
// chat's card by itself: the person picks as long as they like, and Send to
// chat drafts every pick at once, as Copy would, into the chat that asked.

/** The open question card the Mockup's chat asked about this page. */
export type CardQuestion = {
  id: string
  question: string
  options: { label: string; detail?: string }[]
  recommended: number | null
  /** Null until someone answers; `index` null when they typed an answer. */
  answer: { index: number | null } | null
  /** False while the page can't send to the chat (the page is live and nobody has control, or the agent drives it): answer in the chat. */
  answerable?: boolean
}

type Bridge = {
  draft?: (text: string) => boolean
  question?: (onChange: (q: CardQuestion | null) => void) => CardQuestion | null
}

const bridge = () => (window as { screenplay?: Bridge }).screenplay

/** Whether the page can put text in its chat's composer: it's on a canvas. */
export function onCanvas() {
  return typeof bridge()?.draft === "function"
}

/** Fills the chat's composer with `text`; only works from a tap or key press. */
export function draft(text: string) {
  return bridge()?.draft?.(text) ?? false
}

/** Whether the card is open but the page can't send to the chat: answer in the chat. */
export function answersInChat(q: CardQuestion | null): q is CardQuestion {
  return !!q && !q.answer && q.answerable === false
}

// The bridge only adds listeners, so one listener feeds every hook.
let current: CardQuestion | null = null
const listeners = new Set<() => void>()
let listening = false
function subscribe(cb: () => void) {
  listeners.add(cb)
  if (!listening && typeof bridge()?.question === "function") {
    listening = true
    bridge()!.question!((q) => {
      current = q
      listeners.forEach((l) => l())
    })
  }
  return () => listeners.delete(cb)
}

/** The chat's latest question about this page, answered or not; null as an Artifact. */
export function useCardQuestion() {
  return React.useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  )
}

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Which of the page's questions a card asks: the one whose id starts the
 * card's question ("H2: What goes…", "H2 · …"), or else the one whose option
 * labels are the card's, in order. `labels` per page question id.
 */
export function askedId(
  q: CardQuestion | null,
  labels: Record<string, string[]>
): string | null {
  if (!q) return null
  const head = /^\s*([A-Za-z]{1,3}\d+)\b/.exec(q.question)?.[1]
  if (head) {
    const id = Object.keys(labels).find((k) => norm(k) === norm(head))
    if (id) return id
  }
  const card = q.options.map((o) => norm(o.label))
  return (
    Object.keys(labels).find((id) => {
      const mine = labels[id]!.map(norm)
      return mine.length === card.length && mine.every((l, i) => l === card[i])
    }) ?? null
  )
}

/**
 * The card option a page option answers: the one with its label, or else the
 * one in its place when the card has as many options as the page; -1 for none.
 */
export function cardIndex(
  q: CardQuestion,
  labels: string[],
  i: number
): number {
  const byLabel = q.options.findIndex((o) => norm(o.label) === norm(labels[i]!))
  if (byLabel >= 0) return byLabel
  return q.options.length === labels.length ? i : -1
}
