// The design-audit decisions page, the findings page's shape. Header, filter
// tabs (All and one per surface), questions grouped by surface with their
// options drawn like the chat's question card, each starting on the
// recommendation in grey, then the PRs that run regardless. From 1280px it's
// list and detail (shared/detail.tsx). A bar pinned to the bottom carries the
// count, a note and Copy decisions (Send to chat on a canvas, which drafts
// every answer at once; a pick never answers the chat's question card by
// itself).

import * as React from "react"

import { useSharedState } from "@screenplay.space/state"

import { Input } from "@workspace/ui/components/input"
import { cn } from "@workspace/ui/lib/utils"

import {
  askedId,
  answersInChat,
  cardIndex,
  onCanvas,
  useCardQuestion,
} from "../shared/chat.ts"
import { AnswerInChat, Choices } from "../shared/choices.tsx"
import {
  ABOUT,
  DEFAULTED,
  DetailItem,
  DetailLayout,
  DetailNav,
  detailOnly,
  useDetail,
} from "../shared/detail.tsx"
import {
  Intro,
  ItemHead,
  ItemNote,
  Links,
  PAIR,
  SectionHead,
  Shell,
  type Tab,
} from "../shared/kit.tsx"
import { CopyBar, Label, load, store } from "../shared/page.tsx"
import { Shots, type Img } from "../shared/shots.tsx"
import { useTheme } from "../shared/theme.tsx"

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
  const dark = useTheme()
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
  // While the page can't send to the chat (it's live, or the agent drives it), its pick stays here
  const chatOnly = answersInChat(card) ? asked : null
  // An option chosen on the page: it waits for Send to chat
  const choose = (q: Q, v: string) => set(q.id, { v })

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
  // Every question starts on the recommendation, so the tally counts changes
  const changed = all.filter(
    (q) => isAnswered(answers[q.id]!) && answers[q.id]!.v !== "o0"
  ).length
  const shown = surfaces.filter((s) => filter === "all" || filter === s.key)
  const detail = useDetail(
    shown.flatMap((s) => s.qs.map((q) => q.id)),
    { asked: card?.answer ? null : asked }
  )
  const about = detail.sel === ABOUT
  const action = onCanvas() ? "Send to chat" : "Copy decisions"
  const back = onCanvas()
    ? "send it from the chat"
    : "paste the text back in the chat"

  const tabs: Tab[] = [
    { value: "all", label: "All", count: all.length },
    ...surfaces.map((s) => ({
      value: s.key,
      label: s.name,
      count: s.qs.length,
    })),
  ]

  return (
    <Shell
      title={page.title}
      tabs={tabs}
      tab={filter}
      setTab={(v) => {
        setFilter(v)
        scrollTo({ top: 0 })
      }}
      tabsLabel="Filter"
      dark={dark}
      wide
      bar={
        <CopyBar
          wide
          status={
            <>
              <b>{changed}</b> changed
              <span className="max-sm:hidden">
                {" "}
                · {all.length - changed} keep my recommendation
              </span>
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
          send
        />
      }
    >
      <DetailLayout
        about="About these decisions"
        detail={detail}
        groups={shown.map((s) => ({
          name: s.name,
          items: s.qs.map((q) => ({
            id: q.id,
            title: q.t,
            done: isAnswered(answers[q.id]!),
          })),
        }))}
      >
        <Intro
          meta={`${page.label} · ${page.date}`}
          className={detailOnly(about)}
        >
          <p>
            {all.length} {all.length === 1 ? "question" : "questions"} from the{" "}
            {page.plans}. Each starts on my recommendation, in grey. Pick
            another option, pick{" "}
            <b className="font-medium text-foreground">None of these</b>, or
            write your own, and add a note if you like. When you’re done, press{" "}
            <b className="font-medium text-foreground">{action}</b> and {back}.
          </p>
          <Links
            links={[...page.links, ["PRs that need no decision", "#runs"]]}
          />
        </Intro>

        {surfaces.map((s) => (
          <section
            key={s.key}
            id={s.key}
            hidden={filter !== "all" && filter !== s.key}
            className={cn(
              "flex scroll-mt-16 flex-col",
              detailOnly(s.qs.some((q) => q.id === detail.sel))
            )}
          >
            <div className="xl:hidden">
              <SectionHead
                title={s.name}
                blurb={
                  <>
                    {s.intro}{" "}
                    <a href={s.plan} className="text-foreground underline">
                      Open the plan
                    </a>
                  </>
                }
              />
            </div>
            {s.qs.map((q) => (
              <Question
                key={q.id}
                shown={detail.sel === q.id}
                nav={<DetailNav detail={detail} noun="questions" />}
                q={q}
                a={answers[q.id]!}
                set={(a) => set(q.id, a)}
                choose={(v) => choose(q, v)}
                chatOnly={chatOnly === q.id}
              />
            ))}
          </section>
        ))}

        <section
          id="runs"
          hidden={filter !== "all"}
          className={cn("flex scroll-mt-16 flex-col gap-4", detailOnly(about))}
        >
          <SectionHead
            title="PRs that need no decision"
            blurb="These go ahead once you hand the decisions back. A PR marked with a question id waits on that answer."
          />
          {surfaces.map((s) => (
            <div key={s.key} className="flex flex-col gap-1.5">
              <Label>{s.name}</Label>
              <ul className="m-0 list-none border-t p-0">
                {(runs[s.key] ?? []).map(([num, title, w]) => (
                  <li
                    key={num}
                    className="grid grid-cols-[28px_minmax(0,1fr)] items-baseline gap-x-3 border-b py-2 text-sm sm:grid-cols-[36px_minmax(0,1fr)_auto]"
                  >
                    <span className="font-mono text-muted-foreground tabular-nums">
                      {num}
                    </span>
                    <span>{title}</span>
                    <span
                      className={cn(
                        "col-start-2 text-xs sm:col-start-auto sm:text-right",
                        w.startsWith("waits")
                          ? "font-medium text-foreground"
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
        {about && (
          <div className="hidden xl:block">
            <DetailNav detail={detail} noun="questions" />
          </div>
        )}
      </DetailLayout>
    </Shell>
  )
}

function Question({
  q,
  a,
  set,
  choose,
  chatOnly,
  shown,
  nav,
}: {
  q: Q
  a: Answer
  set: (a: Partial<Answer>) => void
  choose: (v: string) => void
  /** The chat's open card asks this, and the page can't send to the chat. */
  chatOnly: boolean
  /** The question list and detail shows */
  shown: boolean
  nav: React.ReactNode
}) {
  const own = React.useRef<HTMLInputElement>(null)
  return (
    <DetailItem
      id={`q-${q.id}`}
      open={!a.v}
      hidden={false}
      shown={shown}
      nav={nav}
      head={
        <>
          <ItemHead id={q.id} title={q.t} meta={q.where} />
          <p className="max-w-[72ch] text-sm text-muted-foreground">{q.c}</p>
        </>
      }
      shots={q.img?.length ? <Shots list={q.img} className={PAIR} /> : null}
      answer={
        <ItemNote
          label={`Note on ${q.id}`}
          note={a.note}
          setNote={(note) => set({ note })}
          stacked
        >
          <div className={cn("contents", !a.v && DEFAULTED)}>
            <Choices
              name={`q-${q.id}`}
              value={a.v || "o0"}
              onChange={(v) => {
                choose(v)
                if (v === "own")
                  requestAnimationFrame(() => own.current?.focus())
              }}
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
          </div>
          <Input
            ref={own}
            hidden={a.v !== "own"}
            aria-label={`Your answer for ${q.id}`}
            placeholder="Your answer"
            value={a.own}
            onChange={(e) => set({ own: e.target.value })}
          />
          {chatOnly && <AnswerInChat />}
        </ItemNote>
      }
    />
  )
}
