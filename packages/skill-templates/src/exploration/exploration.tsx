// The design-exploration page. Phone first, one column at every width: round
// tabs under the question, in time order (Today, Round 1, Round 2…) and
// opening on the newest; each question shows one option at a time behind a
// segmented A/B/C control that sticks to the top while you read. A bar pinned
// to the bottom carries the picks, a note and Copy.

import * as React from "react"
import { flushSync } from "react-dom"

import { useSharedState } from "@screenplay.space/state"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { CheckIcon, XIcon } from "@workspace/ui/components/icons"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

import {
  answerCard,
  type CardQuestion,
  draftToChat,
  onCanvas,
  useCardQuestion,
} from "../shared/canvas.ts"
import { CopyBar, Facts, Html, Label, load, store } from "../shared/page.tsx"
import { Lightbox, Shots } from "../shared/shots.tsx"
import { ThemeButton, ThemeContext, useTheme } from "../shared/theme.tsx"
import type { Option, Page, Question, Round, Today } from "./types.ts"

const SIGN = [
  ["ok", "Looks good"],
  ["changes", "Needs changes"],
] as const
// A question with one option is a sign-off: Looks good / Needs changes
const signoff = (q: Question) => q.options.length === 1

type Picks = Record<string, string | undefined>
type PickProps = {
  picks: Picks
  pick: (q: string, v: string) => void
  /** The question the chat's open card asks, once it's answered (on a canvas). */
  sent?: string
}

// TEMP exploration switches
const V = ((globalThis as { VARIANT?: Record<string, string> }).VARIANT ??
  {}) as Record<string, string>

const norm = (s: string) => s.trim().toLowerCase()
/** The value a card option stands for in question `q`, by its label. */
function cardValues(q: Question, card: CardQuestion): string[] | null {
  const want = signoff(q)
    ? SIGN.map(([v, l]) => [v, [norm(l)]] as const)
    : q.options.map(
        (o) =>
          [o.id, [norm(o.id), "option " + norm(o.id), norm(o.name)]] as const
      )
  if (card.options.length !== want.length) return null
  const ok = card.options.every((c, i) => {
    const l = norm(c.label)
    return want[i]![1].some(
      (w) => l === w || (l.startsWith(w) && !/[a-z0-9]/.test(l[w.length]!))
    )
  })
  return ok ? want.map((w) => w[0]) : null
}

export function Exploration({
  page,
  today,
  rounds,
}: {
  page: Page
  today: Today
  rounds: Round[]
}) {
  const [dark, toggleTheme] = useTheme()
  const latest = rounds[0]!
  const Q = latest.questions
  const KEY = "exploration-" + page.slug
  // Picks and the note belong to the open round; a new round starts empty
  const [saved] = React.useState(() => {
    const s = load<{ round: number; picks: Picks; note: string }>(KEY)
    return s.round === latest.n ? s : {}
  })
  const [picks, setPicks] = React.useState<Picks>(saved.picks ?? {})
  const [note, setNote] = React.useState(saved.note ?? "")
  const [noteOpen, setNoteOpen] = React.useState(!!saved.note)
  React.useEffect(() => {
    store(KEY, { round: latest.n, picks, note })
  }, [KEY, latest.n, picks, note])

  // On a Screenplay canvas, every viewer sees the same picks, note, round
  // and option (@screenplay.space/state; inert anywhere else)
  const sharedPicks = React.useMemo(
    () => JSON.parse(JSON.stringify(picks)) as Record<string, string>,
    [picks]
  )
  useSharedState("picks", sharedPicks, setPicks)
  useSharedState("note", note, setNote)

  // On a canvas, the chat's open card about this page asks one of the open
  // round's questions: a pick there answers it, and its answer shows here
  const card = useCardQuestion()
  const linked = React.useMemo(() => {
    if (!card) return null
    for (const q of Q) {
      const values = cardValues(q, card)
      if (values) return { q, values }
    }
    return null
  }, [card, Q])
  const answered =
    linked && card?.answer ? linked.values[card.answer.index] : undefined
  React.useEffect(() => {
    if (answered && linked)
      setPicks((p) =>
        p[linked.q.key] === answered ? p : { ...p, [linked.q.key]: answered }
      )
  }, [answered, linked])

  const pick = (k: string, v: string) => {
    if (answered && linked?.q.key === k) return
    const next = picks[k] === v ? undefined : v
    if (next && linked?.q.key === k && card && !card.answer)
      answerCard(linked.values.indexOf(next))
    setPicks({ ...picks, [k]: next })
    if (next === "changes") setNoteOpen(true)
  }
  const canvas = onCanvas()
  const answer = (q: Question) => {
    const v = picks[q.key]
    if (!v) return ""
    if (signoff(q)) return SIGN.find((s) => s[0] === v)![1]
    return `${v}: ${q.options.find((o) => o.id === v)!.name}`
  }
  const text = () => {
    const lines = Q.map((q) => {
      const name = signoff(q) ? q.options[0]!.name : q.title
      return "→ " + (name ? name + ": " : "") + (answer(q) || "No pick yet")
    })
    // In the chat, the draft already says which Mockup it came from
    const head = canvas ? [] : [`Exploration: ${page.q}`]
    return [...head, `Round ${latest.n}`, ...lines]
      .concat(note.trim() ? [`Note: ${note.trim()}`] : [])
      .join("\n")
  }
  const done = Q.filter((q) => picks[q.key])
  const status = done.length ? (
    <>
      {done.map((q, i) => (
        <React.Fragment key={q.key}>
          {i > 0 && " · "}
          <b>{Q.length > 1 ? answer(q).split(":")[0] : answer(q)}</b>
          {V.sent === "bar" &&
            answered &&
            linked?.q.key === q.key &&
            " sent to chat"}
        </React.Fragment>
      ))}
      {Q.length > 1 && ` · ${done.length} of ${Q.length} answered`}
    </>
  ) : Q.length > 1 ? (
    `0 of ${Q.length} answered`
  ) : signoff(Q[0]!) ? (
    "Sign off or say what to change"
  ) : (
    "No pick yet"
  )

  return (
    <ThemeContext.Provider value={dark}>
      <Lightbox>
        <div className="mx-auto flex max-w-[880px] flex-col gap-5 px-4 pt-6 pb-[calc(96px+env(safe-area-inset-bottom,0px))] md:gap-6 md:px-6 md:pt-10">
          <header>
            <div className="flex items-center justify-between gap-3">
              <Label accent>Design exploration · {page.date}</Label>
              <ThemeButton dark={dark} toggle={toggleTheme} />
            </div>
            <h1 className="mt-2 mb-2.5 font-heading text-title-xl text-balance">
              {page.q}
            </h1>
            <Quote>{page.quote}</Quote>
          </header>
          <RoundTabs
            rounds={rounds}
            today={today}
            picks={picks}
            pick={pick}
            sent={answered ? linked!.q.key : undefined}
          />
        </div>
        <CopyBar
          status={status}
          note={note}
          setNote={setNote}
          noteOpen={noteOpen}
          setNoteOpen={setNoteOpen}
          copyLabel={canvas ? "Send to chat" : "Copy reaction"}
          send={canvas ? () => draftToChat(text()) : undefined}
          outLabel="Reaction to copy"
          text={text}
          maxWidth="832px"
        />
      </Lightbox>
    </ThemeContext.Provider>
  )
}

function Quote({ className, ...props }: React.ComponentProps<"blockquote">) {
  return (
    <blockquote
      className={cn(
        "m-0 max-w-[68ch] border-l-2 pl-3 text-sm text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

/** Round tabs: quiet underline navigation that fades at whichever edge hides rounds. */
function RoundTabs({
  rounds,
  today,
  ...pickProps
}: { rounds: Round[]; today: Today } & PickProps) {
  const latest = rounds[0]!
  const [tab, setTab] = React.useState(`r${latest.n}`)
  useSharedState("round", tab, setTab)
  const list = React.useRef<HTMLDivElement>(null)
  const [edges, setEdges] = React.useState({ less: false, more: false })
  const fit = React.useCallback(() => {
    const t = list.current!
    setEdges({
      more: t.scrollWidth - t.scrollLeft > t.clientWidth + 1,
      less: t.scrollLeft > 1,
    })
  }, [])
  React.useLayoutEffect(() => {
    // The round row starts scrolled to the newest round
    const t = list.current!
    t.scrollLeft = t.scrollWidth
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

  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      className="flex flex-col gap-5 md:gap-6"
    >
      <TabsList
        ref={list}
        variant="line"
        aria-label="Rounds"
        onScroll={fit}
        style={{ maskImage: mask, WebkitMaskImage: mask }}
        className="h-auto w-full [scrollbar-width:none] justify-start gap-4 overflow-x-auto rounded-none border-b p-0 pb-[5px] [&::-webkit-scrollbar]:hidden"
      >
        <TabsTrigger value="today" className="h-full flex-none px-0">
          Today
        </TabsTrigger>
        {[...rounds].reverse().map((r) => (
          <TabsTrigger
            key={r.n}
            value={`r${r.n}`}
            className="h-full flex-none px-0"
          >
            Round {r.n}
          </TabsTrigger>
        ))}
      </TabsList>
      {rounds.map((r) => (
        <TabsContent
          key={r.n}
          value={`r${r.n}`}
          forceMount
          hidden={tab !== `r${r.n}`}
        >
          <RoundPanel round={r} live={r === latest} {...pickProps} />
        </TabsContent>
      ))}
      <TabsContent value="today" forceMount hidden={tab !== "today"}>
        <section className="flex min-w-0 flex-col gap-4">
          <Label>Today · what main does now</Label>
          {today.facts && <Facts items={today.facts} />}
          <Shots list={today.shots} />
          {today.html && <Html as="div" html={today.html} />}
        </section>
      </TabsContent>
    </Tabs>
  )
}

const outcome = (r: Round) => {
  const p = r.questions.flatMap((q) =>
    q.options
      .filter((o) => o.state === "picked")
      .map((o) => (signoff(q) ? "signed off" : `picked ${o.id}`))
  )
  return p.length ? p.join(", ") : "no pick"
}

function RoundPanel({
  round: r,
  live,
  ...pickProps
}: { round: Round; live: boolean } & PickProps) {
  return (
    <section className="flex min-w-0 flex-col gap-4">
      {V.head !== "fold" && (
        <Label accent={live && V.head !== "quiet"}>
          Round {r.n} · {live ? "open" : outcome(r)}
        </Label>
      )}
      {V.head === "fold" ? (
        <RoundNotes r={r} live={live} />
      ) : (
        V.head !== "after" && (
          <>
            {r.feedback && <Said html={r.feedback} />}
            {r.every && <Every items={r.every} />}
          </>
        )
      )}
      {r.questions.map((q, i) => (
        <QuestionBlock
          key={q.key}
          round={r}
          q={q}
          i={i}
          live={live}
          {...pickProps}
        />
      ))}
      {V.head === "after" && (r.feedback || r.every) && (
        <div className="mt-4 flex flex-col gap-4 border-t border-foreground pt-5">
          <Label>About this round</Label>
          {r.feedback && <Said html={r.feedback} />}
          {r.every && <Every items={r.every} />}
        </div>
      )}
    </section>
  )
}

/** TEMP fold variant: the round label is the trigger for feedback and every. */
function RoundNotes({ r, live }: { r: Round; live: boolean }) {
  const [open, setOpen] = React.useState(false)
  if (!r.feedback && !r.every)
    return (
      <Label accent={live}>
        Round {r.n} · {live ? "open" : outcome(r)}
      </Label>
    )
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="-mt-2 border-b md:-mt-3"
    >
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-3 pb-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Label accent={live}>
          Round {r.n} · {live ? "open" : outcome(r)}
        </Label>
        <span className="text-sm font-medium text-muted-foreground">
          {open ? "Hide" : r.feedback ? "Your feedback" : "Show"}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-3.5 pb-3.5">
        {r.feedback && (
          <Html
            as="blockquote"
            html={r.feedback}
            className="m-0 max-w-[68ch] border-l-2 pl-3 text-sm text-muted-foreground"
          />
        )}
        {r.every && (
          <>
            <Label>In every option</Label>
            <Facts items={r.every} />
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

/** The owner's feedback shows three lines until opened. */
function Said({ html }: { html: string }) {
  const [clamp, setClamp] = React.useState(true)
  const [overflows, setOverflows] = React.useState(false)
  const ref = React.useRef<HTMLQuoteElement>(null)
  React.useLayoutEffect(() => {
    const q = ref.current!
    // Measures again when its tab shows and on resize
    const ro = new ResizeObserver(() =>
      setOverflows(q.scrollHeight > q.clientHeight + 1)
    )
    ro.observe(q)
    return () => ro.disconnect()
  }, [])
  return (
    <div className="flex flex-col items-start gap-1">
      <Html
        as="blockquote"
        ref={ref}
        html={html}
        className={cn(
          "m-0 max-w-[68ch] border-l-2 pl-3 text-sm text-muted-foreground",
          clamp && "line-clamp-3"
        )}
      />
      {(overflows || !clamp) && (
        <Button
          type="button"
          variant="link"
          size="xs"
          className="ml-3.5 h-auto p-0 text-muted-foreground underline"
          onClick={() => setClamp(!clamp)}
        >
          {clamp ? "Show all" : "Show less"}
        </Button>
      )}
    </div>
  )
}

/** Folded block: what every option in the round shares. */
function Every({ items }: { items: string | string[] }) {
  const [open, setOpen] = React.useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-y">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-3 py-2.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <Label>In every option</Label>
        <span className="text-sm font-medium text-muted-foreground">
          {open ? "Hide" : "Show"}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="pb-3.5">
        <Facts items={items} />
      </CollapsibleContent>
    </Collapsible>
  )
}

// Option tabs: letter only; a dot marks the recommendation, a tick the pick
function Mark({ o, mine }: { o: Option; mine: boolean }) {
  if (mine)
    return (
      <CheckIcon aria-label="your pick" className="size-3.5 text-success" />
    )
  if (o.state === "picked")
    return <CheckIcon aria-label="picked" className="size-3.5 text-success" />
  if (o.state === "rejected")
    return <XIcon aria-label="rejected" className="size-3.5 text-destructive" />
  if (o.rec)
    return (
      <span
        aria-label="recommended"
        className="size-1.5 rounded-full bg-info"
      />
    )
  return null
}

function QuestionBlock({
  round: r,
  q,
  i,
  live,
  picks,
  pick,
  sent,
}: { round: Round; q: Question; i: number; live: boolean } & PickProps) {
  const n = r.questions.length
  const [opt, setOpt] = React.useState(
    () => (q.options.find((o) => o.state === "picked") ?? q.options[0]!).id
  )
  useSharedState(`option:r${r.n}-${q.key}`, opt, setOpt)
  const root = React.useRef<HTMLDivElement>(null)
  const bar = React.useRef<HTMLDivElement>(null)
  const choose = (id: string) => {
    flushSync(() => setOpt(id))
    // When the tabs are stuck to the top, start the new option from its beginning
    const b = bar.current!
    const stuck =
      b.getBoundingClientRect().top <= parseFloat(getComputedStyle(b).top) + 1
    const panel = root.current!.querySelector(
      ":scope>[role=tabpanel]:not([hidden])"
    )
    if (stuck && panel)
      scrollTo({
        top: scrollY + panel.getBoundingClientRect().top - b.offsetHeight - 12,
        behavior: "instant",
      })
  }
  const head = (q.title || n > 1) && (
    <div className="flex flex-col gap-1">
      {n > 1 && (
        <Label accent={V.head !== "quiet"}>
          Question {i + 1} of {n}
        </Label>
      )}
      {q.title && (
        <h2 className="m-0 font-heading text-title-md text-balance">
          {q.title}
        </h2>
      )}
      {q.intro && (
        <Html as="p" html={q.intro} className="text-sm text-muted-foreground" />
      )}
    </div>
  )
  const card = (o: Option) => (
    <Card
      q={q}
      o={o}
      live={live}
      picks={picks}
      pick={pick}
      sent={live && sent === q.key ? sent : undefined}
    />
  )
  const wrap = cn(
    "flex min-w-0 flex-col gap-3.5",
    i > 0 && "mt-4 border-t border-foreground pt-5"
  )
  if (signoff(q))
    return (
      <div className={wrap}>
        {head}
        {card(q.options[0]!)}
      </div>
    )
  return (
    <Tabs value={opt} onValueChange={choose} className={wrap} ref={root}>
      {head}
      {/* Stuck, the control keeps a page-coloured margin so content never shows around its corners */}
      <TabsList
        ref={bar}
        aria-label="Options"
        className="sticky top-[calc(env(safe-area-inset-top,0px)+8px)] z-[5] my-1 w-full shadow-[0_0_0_8px_var(--background),-16px_0_0_8px_var(--background),16px_0_0_8px_var(--background)] group-data-horizontal/tabs:h-10"
      >
        {q.options.map((o) => (
          <TabsTrigger
            key={o.id}
            value={o.id}
            className="flex-1 justify-center font-mono font-semibold data-active:border-border"
          >
            {o.id}
            <Mark o={o} mine={live && picks[q.key] === o.id} />
          </TabsTrigger>
        ))}
      </TabsList>
      {q.options.map((o) => (
        <TabsContent
          key={o.id}
          value={o.id}
          forceMount
          hidden={opt !== o.id}
          className="flex-none"
        >
          {card(o)}
        </TabsContent>
      ))}
    </Tabs>
  )
}

function Card({
  q,
  o,
  live,
  picks,
  pick,
  sent,
}: { q: Question; o: Option; live: boolean } & PickProps) {
  const choices = signoff(q) ? SIGN : ([[o.id, "Pick " + o.id]] as const)
  return (
    <article className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-col gap-1.5">
        {!signoff(q) && (
          <span
            className={cn(
              "font-mono text-sm font-semibold",
              V.head === "quiet" ? "text-muted-foreground" : "text-info"
            )}
          >
            Option {o.id}
          </span>
        )}
        <h3 className="m-0 font-heading text-title-sm text-balance">
          {o.name}
        </h3>
        {(o.rec || o.state) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {o.rec && (
              <Badge variant="outline" className="text-info">
                Recommended
              </Badge>
            )}
            {o.state === "picked" && (
              <Badge variant="outline" className="text-success">
                Picked
              </Badge>
            )}
            {o.state === "rejected" && (
              <Badge variant="outline" className="text-destructive">
                Rejected
              </Badge>
            )}
          </div>
        )}
      </header>
      {o.html && <Html as="div" html={o.html} />}
      <Shots
        list={o.shots}
        className={o.state === "rejected" ? "opacity-55" : undefined}
      />
      {o.why && <Html as="p" html={o.why} className="max-w-[72ch] text-sm" />}
      {o.cost && (
        <p className="m-0 max-w-[72ch] text-sm text-muted-foreground">
          <b className="font-medium text-foreground">Cost</b>{" "}
          <Html as="span" html={o.cost} />
        </p>
      )}
      {live && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {choices.map(([v, l]) => {
            const on = picks[q.key] === v
            return (
              <Button
                key={v}
                type="button"
                size="lg"
                variant={on ? "default" : "outline"}
                aria-pressed={on}
                disabled={!!sent && !on}
                onClick={() => pick(q.key, v)}
              >
                {l}
              </Button>
            )
          })}
          {sent && V.sent !== "bar" && (
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <CheckIcon className="size-4 text-success" />
              {choices.some(([v]) => picks[q.key] === v)
                ? "Answered in chat"
                : `Answered ${picks[q.key]} in chat`}
            </span>
          )}
        </div>
      )}
    </article>
  )
}
