// List and detail for the answer pages (audit, decisions). From 1280px, a
// Mockup's default width, three columns: every item in a list on the left,
// one item in the middle and its answer pinned on the right, with Previous
// and Next under it. From 1024px the list goes and every item is on the page,
// each with its answer pinned beside it. A phone keeps one column.

import * as React from "react"

import { useSharedState } from "@screenplay.space/state"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { Label } from "./page.tsx"

/** The list's first entry: the page's intro, notices and folds. */
export const ABOUT = "about"

export type ListItem = { id: string; title: string; done: boolean }
export type ListGroup = { name: string; items: ListItem[] }

/** Wide enough for three columns. */
const THREE_COLUMNS = "(min-width: 80rem)"

/** Hidden in list and detail, while `on` is false. */
export const detailOnly = (on: boolean) => (on ? undefined : "xl:hidden")

/**
 * The item shown (ABOUT or an id), shared on a canvas like the filter. It
 * falls back to ABOUT when the filter hides it, and ← and → step through
 * `ids` unless a field or a choice has focus.
 */
export function useDetail(ids: string[]) {
  const [sel, setSel] = React.useState(ABOUT)
  useSharedState("item", sel, setSel)
  const all = [ABOUT, ...ids]
  const shown = all.includes(sel) ? sel : ABOUT
  const go = React.useCallback((id: string) => {
    setSel(id)
    scrollTo({ top: 0, behavior: "instant" })
  }, [])
  const step = React.useRef<(by: number) => void>(null)
  step.current = (by) => {
    const next = all[all.indexOf(shown) + by]
    if (next) go(next)
  }
  React.useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
      if (!matchMedia(THREE_COLUMNS).matches) return
      const t = e.target as HTMLElement
      if (
        t.closest(
          "input,textarea,select,[role=radiogroup],[role=group],[contenteditable=true]"
        )
      )
        return
      e.preventDefault()
      step.current!(e.key === "ArrowRight" ? 1 : -1)
    }
    addEventListener("keydown", on)
    return () => removeEventListener("keydown", on)
  }, [])
  return { sel: shown, go, ids }
}

/** The list column and the page beside it. */
export function DetailLayout({
  about,
  groups,
  detail: { sel, go },
  children,
}: {
  /** The About entry's title, such as “About this audit” */
  about: string
  groups: ListGroup[]
  detail: ReturnType<typeof useDetail>
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[224px_minmax(0,1fr)] xl:gap-10">
      <List about={about} groups={groups} sel={sel} go={go} />
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
    </div>
  )
}

function List({
  about,
  groups,
  sel,
  go,
}: {
  about: string
  groups: ListGroup[]
  sel: string
  go: (id: string) => void
}) {
  const nav = React.useRef<HTMLElement>(null)
  // Keep the shown item in view as Next and the arrow keys move through
  React.useEffect(() => {
    nav.current
      ?.querySelector("[aria-current]")
      ?.scrollIntoView({ block: "nearest" })
  }, [sel])
  return (
    <nav
      ref={nav}
      aria-label="Items"
      className="sticky top-[calc(var(--top-bar,0px)+24px)] -mx-2 hidden max-h-[calc(100vh-var(--top-bar,0px)-24px-88px)] [scrollbar-width:thin] flex-col gap-5 self-start overflow-y-auto xl:flex"
    >
      <Row id={ABOUT} title={about} sel={sel} go={go} />
      {groups
        .filter((g) => g.items.length)
        .map((g) => (
          <div key={g.name} className="flex flex-col">
            <div className="mb-1 flex items-baseline justify-between px-2">
              <Label>{g.name}</Label>
              <span className="font-mono text-xs text-muted-foreground tabular-nums">
                {g.items.filter((i) => i.done).length}/{g.items.length}
              </span>
            </div>
            {g.items.map((i) => (
              <Row key={i.id} {...i} sel={sel} go={go} />
            ))}
          </div>
        ))}
    </nav>
  )
}

function Row({
  id,
  title,
  done,
  sel,
  go,
}: {
  id: string
  title: string
  done?: boolean
  sel: string
  go: (id: string) => void
}) {
  const about = id === ABOUT
  return (
    <button
      type="button"
      aria-current={sel === id ? "true" : undefined}
      onClick={() => go(id)}
      className={cn(
        "grid grid-cols-[8px_28px_minmax(0,1fr)] items-baseline gap-x-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground outline-none hover:bg-muted/60 hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50",
        sel === id && "bg-muted font-medium text-foreground"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 -translate-y-px rounded-full border border-current",
          done && "bg-current",
          about && "invisible"
        )}
      />
      <span className="font-mono text-xs">{about ? "" : id}</span>
      <span className="line-clamp-2 min-w-0">
        {title}
        {done && <span className="sr-only">, answered</span>}
      </span>
    </button>
  )
}

/**
 * One item: what to read on the left, its answer pinned on the right from
 * 1024px, captures under the reading. In list and detail only the shown one
 * is on the page, with Previous and Next under its answer.
 */
export function DetailItem({
  id,
  open,
  hidden,
  shown,
  head,
  shots,
  answer,
  nav,
}: {
  id: string
  /** Unanswered, for whatever looks for the next open item */
  open: boolean
  hidden: boolean
  shown: boolean
  head: React.ReactNode
  /** Captures, or nothing when there are none */
  shots?: React.ReactNode
  answer: React.ReactNode
  nav: React.ReactNode
}) {
  return (
    <article
      id={id}
      hidden={hidden}
      data-open={open ? "" : undefined}
      className={cn(
        "flex min-w-0 scroll-mt-16 flex-col gap-2.5 border-b py-5 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-x-10 xl:border-b-0 xl:pt-0",
        detailOnly(shown)
      )}
    >
      <div className="flex min-w-0 flex-col gap-2.5 lg:col-start-1 lg:row-start-1">
        {head}
      </div>
      {shots && (
        <div className="flex min-w-0 flex-col gap-2.5 lg:col-start-1 lg:row-start-2">
          {shots}
        </div>
      )}
      <div className="flex min-w-0 flex-col gap-2.5 self-start lg:sticky lg:top-[calc(var(--top-bar,0px)+16px)] lg:col-start-2 lg:row-span-2 lg:row-start-1">
        {answer}
        {shown && <div className="hidden xl:block">{nav}</div>}
      </div>
    </article>
  )
}

/** Previous, where you are, and Next, for list and detail. */
export function DetailNav({
  detail: { sel, go, ids },
  noun,
}: {
  detail: ReturnType<typeof useDetail>
  /** Plural, for the About entry: “33 findings” */
  noun: string
}) {
  const i = ids.indexOf(sel)
  const prev = i > 0 ? ids[i - 1] : undefined
  const next = ids[i + 1]
  return (
    <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
      <Button
        type="button"
        variant="ghost"
        disabled={!prev}
        onClick={() => prev && go(prev)}
        className="-ml-2.5 text-muted-foreground"
      >
        {prev ? `Previous: ${prev}` : "Previous"}
      </Button>
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        {i < 0 ? `${ids.length} ${noun}` : `${i + 1} of ${ids.length}`}
      </span>
      <Button
        type="button"
        variant="outline"
        disabled={!next}
        onClick={() => next && go(next)}
      >
        {next ? `Next: ${next}` : "Next"}
      </Button>
    </div>
  )
}

/**
 * The recommendation, shown as the answer until someone picks: checked like
 * a pick, but grey (a choice's dot, or the toggle's fill under grey text).
 */
export const DEFAULTED =
  "[&_[data-slot=toggle-group-item]]:!text-muted-foreground [&_[data-checked]]:!border-input [&_[data-checked]]:!bg-transparent [&_[data-checked]_[data-slot=questionnaire-choice-indicator]]:!border-muted-foreground [&_[data-checked]_[data-slot=questionnaire-choice-indicator]]:!bg-muted-foreground"
