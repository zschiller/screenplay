// The design-audit decisions page: one column, the findings page's shape.
// Header, filter tabs (All and one per surface), questions grouped by
// surface with their options drawn like the chat's question card, then the
// PRs that run regardless. A bar pinned to the bottom carries the count, a
// note and Copy decisions (Send to chat on a canvas, where the question the
// chat asks about with a question card answers that card).

import * as React from "react"
import { flushSync } from "react-dom"

import { useSharedState } from "@screenplay.space/state"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"

import {
  answer,
  askedId,
  cardIndex,
  onCanvas,
  useCardQuestion,
  type CardQuestion,
} from "../shared/chat.ts"
import { AskedBadge, Choices, useEdgeFade } from "../shared/choices.tsx"
import { CopyBar, Label, load, store } from "../shared/page.tsx"
import { Lightbox, Shots, type Img } from "../shared/shots.tsx"
import { ThemeButton, ThemeContext, useTheme } from "../shared/theme.tsx"

export type Page = {
  label: string
  date: string
  title: string
  plans: string
  links: [string, string][]
  slug: string
}
export type Q = {
  id: string
  where: string
  t: string
  c: string
  o: [string, string][]
  img?: Img[]
}
export type Surface = {
  key: string
  name: string
  plan: string
  intro: string
  qs: Q[]
}
export type Runs = Record<string, [number, string, string][]>

/** v: "o0" "o1"… for an option, "none", "own" or "" when unanswered. */
type Answer = { v: string; own: string; note: string }
const EMPTY: Answer = { v: "", own: "", note: "" }

export function Decisions({
  page,
  surfaces,
  runs,
}: {
  page: Page
  surfaces: Surface[]
  runs: Runs
}) {
  const [dark, toggleTheme] = useTheme()
  const KEY = "decisions-" + page.slug
  const all = surfaces.flatMap((s) => s.qs)
  const [answers, setAnswers] = React.useState<Record<string, Answer>>(() => {
    const saved = load<Record<string, Answer>>(KEY)
    return Object.fromEntries(
      all.map((q) => [q.id, { ...EMPTY, ...saved[q.id] }])
    )
  })
  React.useEffect(() => store(KEY, answers), [KEY, answers])
  const [filter, setFilter] = React.useState("all")
  const [noteOpen, setNoteOpen] = React.useState(false)
  const [note, setNote] = React.useState("")
  // On a Screenplay canvas, every viewer sees the same answers and filter
  // (@screenplay.space/state; inert anywhere else)
  useSharedState("answers", answers, setAnswers)
  useSharedState("filter", filter, setFilter)
  useSharedState("note", note, setNote)
  const set = (id: string, a: Partial<Answer>) =>
    setAnswers((s) => ({ ...s, [id]: { ...s[id]!, ...a } }))

  // The question the chat's open card asks about, on a canvas
  const card = useCardQuestion()
  const asked = askedId(
    card,
    Object.fromEntries(all.map((q) => [q.id, q.o.map(([l]) => l)]))
  )
  const askedQ = asked ? all.find((q) => q.id === asked) : undefined
  // An answer on the card (from here, the chat or anyone) is that question's
  const answeredOption =
    card && askedQ && card.answer?.index != null
      ? askedQ.o.findIndex(
          (_, i, o) =>
            cardIndex(
              card,
              o.map(([l]) => l),
              i
            ) === card.answer!.index
        )
      : -1
  React.useEffect(() => {
    if (!asked || answeredOption < 0) return
    setAnswers((s) =>
      s[asked]!.v === `o${answeredOption}`
        ? s
        : { ...s, [asked]: { ...s[asked]!, v: `o${answeredOption}` } }
    )
  }, [asked, answeredOption])
  // A new question opens the page at it
  React.useEffect(() => {
    if (asked) document.getElementById(`q-${asked}`)?.scrollIntoView()
  }, [asked, card?.id])
  // An option chosen on the page answers the card too, when it's the card's
  const choose = (q: Q, v: string) => {
    if (q.id === asked && card && !card.answer && v.startsWith("o")) {
      const at = cardIndex(
        card,
        q.o.map(([l]) => l),
        +v.slice(1)
      )
      if (at >= 0) answer(at)
    }
    set(q.id, { v })
  }

  const answerText = (q: Q, s: Answer) => {
    if (s.v === "none") return "None of these"
    if (s.v === "own")
      return s.own.trim()
        ? `Write my own: ${s.own.trim()}`
        : "Write my own: (left blank)"
    if (s.v) {
      const i = +s.v.slice(1)
      return q.o[i]![0] + (i === 0 ? " (recommended)" : "")
    }
    return `No answer; recommendation stands (${q.o[0]![0]})`
  }
  const text = () => {
    const lines = [`Decisions on the ${page.plans} (${page.date})`, ""]
    for (const sf of surfaces) {
      lines.push(sf.name.toUpperCase())
      for (const q of sf.qs) {
        const s = answers[q.id]!
        lines.push(`${q.id}. ${q.t}`)
        lines.push(`   → ${answerText(q, s)}`)
        if (s.note.trim()) lines.push(`   Note: ${s.note.trim()}`)
      }
      lines.push("")
    }
    if (note.trim()) lines.push("Note: " + note.trim())
    return lines.join("\n").trim()
  }
  const isAnswered = (s: Answer) => !!s.v && !(s.v === "own" && !s.own.trim())
  const n = all.filter((q) => isAnswered(answers[q.id]!)).length
  const action = onCanvas() ? "Send to chat" : "Copy decisions"
  const back = onCanvas()
    ? "send it from the chat"
    : "paste the text back in the chat"

  const tabs: [string, string][] = [
    ["all", "All · " + all.length],
    ...surfaces.map((s): [string, string] => [
      s.key,
      `${s.name} · ${s.qs.length}`,
    ]),
  ]
  const fade = useEdgeFade<HTMLDivElement>()

  return (
    <ThemeContext.Provider value={dark}>
      <Lightbox>
        <div className="mx-auto flex max-w-[860px] flex-col gap-6 px-4 pt-6 pb-[calc(112px+env(safe-area-inset-bottom,0px))] md:px-6 md:pt-10">
          <header>
            <div className="flex items-center justify-between gap-3">
              <Label accent>
                {page.label} · {page.date}
              </Label>
              <ThemeButton dark={dark} toggle={toggleTheme} />
            </div>
            <h1 className="mt-2 mb-2.5 font-heading text-title-xl text-balance">
              {page.title}
            </h1>
            <div className="flex max-w-[72ch] flex-col gap-2 text-sm text-muted-foreground">
              <p>
                {all.length} {all.length === 1 ? "question" : "questions"} from
                the {page.plans}. Pick an option, pick{" "}
                <b className="font-medium text-foreground">None of these</b>, or
                write your own, and add a note if you like. Anything you leave
                blank keeps my recommendation. When you’re done, press{" "}
                <b className="font-medium text-foreground">{action}</b> and{" "}
                {back}.
              </p>
              <p>
                {page.links.map(([t, u]) => (
                  <React.Fragment key={u}>
                    <a href={u} className="text-foreground underline">
                      {t}
                    </a>
                    {" · "}
                  </React.Fragment>
                ))}
                <a href="#runs" className="text-foreground underline">
                  PRs that need no decision
                </a>
              </p>
            </div>
          </header>
          <nav
            aria-label="Filter"
            className="sticky top-[env(safe-area-inset-top,0px)] z-[6] -mx-4 border-b bg-background px-4 py-2 md:-mx-6 md:px-6"
          >
            {/* Scrolls sideways on a phone, fading where it hides tabs */}
            <div
              ref={fade.ref}
              onScroll={fade.onScroll}
              style={fade.style}
              className="[scrollbar-width:none] overflow-x-auto [&::-webkit-scrollbar]:hidden"
            >
              <ToggleGroup
                type="single"
                value={filter}
                onValueChange={(v) => {
                  if (!v) return
                  setFilter(v)
                  scrollTo({ top: 0 })
                }}
                className="border-0 p-0"
              >
                {tabs.map(([k, l]) => (
                  <ToggleGroupItem key={k} value={k} className="h-8 px-2.5">
                    {l}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>
          </nav>

          {surfaces.map((s) => (
            <section
              key={s.key}
              id={s.key}
              hidden={filter !== "all" && filter !== s.key}
              className="flex scroll-mt-16 flex-col"
            >
              <div className="mt-2 flex flex-col gap-1 border-b border-foreground pb-2.5">
                <h2 className="m-0 font-heading text-title-md text-balance">
                  {s.name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {s.intro}{" "}
                  <a href={s.plan} className="text-foreground underline">
                    Open the plan
                  </a>
                </p>
              </div>
              {s.qs.map((q) => (
                <Question
                  key={q.id}
                  q={q}
                  a={answers[q.id]!}
                  answered={isAnswered(answers[q.id]!)}
                  set={(a) => set(q.id, a)}
                  choose={(v) => choose(q, v)}
                  asked={q.id === asked ? card! : undefined}
                />
              ))}
            </section>
          ))}

          <section
            id="runs"
            hidden={filter !== "all"}
            className="flex scroll-mt-16 flex-col gap-4"
          >
            <div className="mt-2 flex flex-col gap-1 border-b border-foreground pb-2.5">
              <h2 className="m-0 font-heading text-title-md text-balance">
                PRs that need no decision
              </h2>
              <p className="text-sm text-muted-foreground">
                These go ahead once you hand the decisions back. A PR marked
                with a question id waits on that answer.
              </p>
            </div>
            {surfaces.map((s) => (
              <div key={s.key} className="flex flex-col gap-1.5">
                <Label>{s.name}</Label>
                <ul className="m-0 list-none border-t p-0">
                  {(runs[s.key] ?? []).map(([num, title, w]) => (
                    <li
                      key={num}
                      className="grid grid-cols-[28px_minmax(0,1fr)] items-baseline gap-x-3 border-b py-2 text-sm sm:grid-cols-[36px_minmax(0,1fr)_auto]"
                    >
                      <span className="font-mono text-info tabular-nums">
                        {num}
                      </span>
                      <span>{title}</span>
                      <span
                        className={cn(
                          "col-start-2 text-xs sm:col-start-auto sm:text-right",
                          w.startsWith("waits")
                            ? "text-info"
                            : "text-muted-foreground"
                        )}
                      >
                        {w || "runs regardless"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>
        <CopyBar
          status={
            <>
              <b>{n}</b> of {all.length} answered
            </>
          }
          note={note}
          setNote={setNote}
          noteOpen={noteOpen}
          setNoteOpen={setNoteOpen}
          copyLabel="Copy decisions"
          fallbackLabel="Select and copy"
          outLabel="Decisions to copy"
          text={text}
          maxWidth="812px"
          send
        />
      </Lightbox>
    </ThemeContext.Provider>
  )
}

function Question({
  q,
  a,
  answered,
  set,
  choose,
  asked,
}: {
  q: Q
  a: Answer
  answered: boolean
  set: (a: Partial<Answer>) => void
  choose: (v: string) => void
  /** The chat's open card, when it asks about this question. */
  asked?: CardQuestion
}) {
  const own = React.useRef<HTMLInputElement>(null)
  const noteRef = React.useRef<HTMLTextAreaElement>(null)
  const [noteOpen, setNoteOpen] = React.useState(!!a.note)
  return (
    <div
      id={`q-${q.id}`}
      className="flex min-w-0 scroll-mt-16 flex-col gap-2.5 border-b py-5"
    >
      <header className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <span className="font-mono text-sm font-semibold text-info">
            {q.id}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {q.where}
          </span>
        </div>
        <h3 className="m-0 text-sm font-medium text-balance">{q.t}</h3>
      </header>
      {(asked || answered) && (
        <div className="flex flex-wrap gap-1.5">
          {asked ? (
            <AskedBadge answered={!!asked.answer} />
          ) : (
            <Badge variant="outline" className="text-success">
              Answered
            </Badge>
          )}
        </div>
      )}
      <p className="max-w-[72ch] text-sm text-muted-foreground">{q.c}</p>
      {/* At most two across, so a capture reads without tapping */}
      <Shots
        list={q.img}
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] gap-2"
      />
      <Choices
        name={`q-${q.id}`}
        value={a.v}
        onChange={(v) => {
          choose(v)
          if (v === "own") requestAnimationFrame(() => own.current?.focus())
        }}
        asked={asked ? (asked.answer ? "answered" : "open") : undefined}
        choices={[
          ...q.o.map(([label, detail], i) => ({
            value: `o${i}`,
            label,
            detail,
            rec: i === 0,
          })),
          { value: "none", label: "None of these", quiet: true },
          { value: "own", label: "Write my own", quiet: true },
        ]}
      />
      <Input
        ref={own}
        hidden={a.v !== "own"}
        aria-label={`Your answer for ${q.id}`}
        placeholder="Your answer"
        value={a.own}
        onChange={(e) => set({ own: e.target.value })}
        className="max-w-[72ch]"
      />
      <Button
        type="button"
        variant="ghost"
        // Its label lines up with the options, not its padding
        className="-ml-2.5 self-start text-muted-foreground"
        onClick={() => {
          flushSync(() => setNoteOpen(!noteOpen))
          if (!noteOpen) noteRef.current?.focus()
        }}
      >
        Note
      </Button>
      <Textarea
        ref={noteRef}
        hidden={!noteOpen}
        aria-label={`Note on ${q.id}`}
        placeholder={`Note on ${q.id}`}
        value={a.note}
        onChange={(e) => set({ note: e.target.value })}
        className="min-h-14 max-w-[72ch] resize-y text-sm md:text-sm"
      />
    </div>
  )
}
