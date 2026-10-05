// The design-exploration page: round tabs under the question, in time order
// (Today, Round 1, Round 2…) and opening on the newest. A round is laid out
// like the audit (shared/detail.tsx): its questions in a list, the option
// you're viewing (A/B/C letters or ← →) and your answer as the chat card's
// choice rows. A bar pinned to the bottom carries the picks, a note and Copy.

import * as React from "react"

import { useSharedState } from "@screenplay.space/state"

import { Button } from "@workspace/ui/components/button"
import { CheckIcon, XIcon } from "@workspace/ui/components/icons"
import { TabsContent } from "@workspace/ui/components/tabs"

import {
  answer as answerCard,
  answersInChat,
  canAnswer,
  type CardQuestion,
  onCanvas,
  useCardQuestion,
} from "../shared/chat.ts"
import {
  Intro,
  ItemHead,
  Rec,
  RecDot,
  SectionHead,
  Segmented,
  Shell,
  Tag,
} from "../shared/kit.tsx"
import {
  ABOUT,
  DetailItem,
  DetailLayout,
  DetailNav,
  detailOnly,
  useDetail,
} from "../shared/detail.tsx"
import { AnswerInChat, Choices } from "../shared/choices.tsx"
import { CopyBar, Facts, Html, Label, load, store } from "../shared/page.tsx"
import { Shots } from "../shared/shots.tsx"
import { useTheme } from "../shared/theme.tsx"
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
  /** The question the chat's open card asks while a pick here can't answer it (the page is live, or the agent drives it). */
  chatOnly?: string
}

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
  const theme = useTheme()
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
    linked && card?.answer?.index != null
      ? linked.values[card.answer.index]
      : undefined
  React.useEffect(() => {
    if (answered && linked)
      setPicks((p) =>
        p[linked.q.key] === answered ? p : { ...p, [linked.q.key]: answered }
      )
  }, [answered, linked])

  const pick = (k: string, v: string) => {
    if (answered && linked?.q.key === k) return
    const next = picks[k] === v ? undefined : v
    if (next && linked?.q.key === k && canAnswer(card))
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

  const [tab, setTab] = React.useState(`r${latest.n}`)
  useSharedState("round", tab, setTab)
  const pickProps = {
    picks,
    pick,
    sent: answered ? linked!.q.key : undefined,
    chatOnly: linked && answersInChat(card) ? linked.q.key : undefined,
  }

  return (
    <Shell
      title={page.q}
      tabs={[
        { value: "today", label: "Today" },
        ...[...rounds].reverse().map((r) => ({
          value: `r${r.n}`,
          label: `Round ${r.n}`,
        })),
      ]}
      tab={tab}
      setTab={setTab}
      tabsLabel="Rounds"
      theme={theme}
      wide
      bar={
        <CopyBar
          status={status}
          note={note}
          setNote={setNote}
          noteOpen={noteOpen}
          setNoteOpen={setNoteOpen}
          copyLabel="Copy reaction"
          outLabel="Reaction to copy"
          text={text}
          send
          wide
        />
      }
    >
      {tab === "today" && (
        <Intro meta={`Design exploration · ${page.date}`} quote={page.quote} />
      )}
      {rounds.map((r) => (
        <TabsContent
          key={r.n}
          value={`r${r.n}`}
          forceMount
          hidden={tab !== `r${r.n}`}
        >
          <RoundPanel
            round={r}
            live={r === latest}
            shownTab={tab === `r${r.n}`}
            page={page}
            {...pickProps}
          />
        </TabsContent>
      ))}
      <TabsContent value="today" forceMount hidden={tab !== "today"}>
        <section className="flex min-w-0 flex-col gap-4">
          <SectionHead eyebrow="Today" title="What main does now" />
          {today.facts && <Facts items={today.facts} />}
          <Shots list={today.shots} />
          {today.html && <Html as="div" html={today.html} />}
        </section>
      </TabsContent>
    </Shell>
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

/** From 1024px, each question's answer sits beside it, so the middle shows one option at a time. */
const BESIDE = "(min-width: 64rem)"
function useBeside() {
  const [on, setOn] = React.useState(() => matchMedia(BESIDE).matches)
  React.useEffect(() => {
    const mq = matchMedia(BESIDE)
    const change = () => setOn(mq.matches)
    mq.addEventListener("change", change)
    return () => mq.removeEventListener("change", change)
  }, [])
  return on
}

/**
 * A round as the audit lays out its findings: from 1280px the round's
 * questions on the left, the option you're viewing in the middle (letters or
 * ← →) and your answer pinned on the right, one question at a time. From
 * 1024px the list goes and every question is on the page. A phone is one
 * scroll: each question, every option in full, then its answer.
 */
function RoundPanel({
  round: r,
  live,
  shownTab,
  page,
  ...pickProps
}: {
  round: Round
  live: boolean
  shownTab: boolean
  page: Page
} & PickProps) {
  const { picks } = pickProps
  const beside = useBeside()
  const n = r.questions.length
  const ids = r.questions.map((_, i) => String(i + 1))
  // The option each question shows beside its answer
  const [opts, setOpts] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(
      r.questions.map((q) => [
        q.key,
        (q.options.find((o) => o.state === "picked") ?? q.options[0]!).id,
      ])
    )
  )
  useSharedState(`options:r${r.n}`, opts, setOpts)
  const view = (q: Question, id: string) =>
    id && setOpts((v) => ({ ...v, [q.key]: id }))
  const detail = useDetail(ids, {
    key: `question:r${r.n}`,
    active: shownTab,
    // ← and → move through the shown question's options first
    step: (sel, by) => {
      const q = r.questions[ids.indexOf(sel)]
      if (!q || signoff(q)) return false
      const i = q.options.findIndex((o) => o.id === opts[q.key])
      const next = q.options[i + by]
      if (next) view(q, next.id)
      return !!next
    },
  })
  const about = detail.sel === ABOUT
  const answered = (q: Question) =>
    live ? !!picks[q.key] : q.options.some((o) => o.state === "picked")
  const nav = <DetailNav detail={detail} noun="questions" />
  return (
    <DetailLayout
      about="About this round"
      detail={detail}
      groups={[
        {
          name: `Round ${r.n}`,
          items: r.questions.map((q, i) => ({
            id: ids[i]!,
            title: q.title || page.q,
            done: answered(q),
          })),
        },
      ]}
    >
      {(r.feedback || r.every) && (
        <div className={detailOnly(about)}>
          <About r={r} live={live} />
        </div>
      )}
      {r.questions.map((q, i) => {
        const o = q.options.find((x) => x.id === opts[q.key])!
        return (
          <DetailItem
            key={q.key}
            id={`r${r.n}-${ids[i]}`}
            open={!answered(q)}
            hidden={false}
            shown={detail.sel === ids[i]}
            nav={nav}
            head={
              beside ? (
                <>
                  {!signoff(q) && (
                    <Segmented
                      aria-label="Options"
                      value={o.id}
                      onChange={(id) => view(q, id)}
                      items={q.options.map((x) => ({
                        value: x.id,
                        label: (
                          <>
                            <span className="font-mono font-semibold">
                              {x.id}
                            </span>
                            <Mark o={x} mine={live && picks[q.key] === x.id} />
                          </>
                        ),
                      }))}
                      className="flex w-fit"
                      itemClassName="min-w-14"
                    />
                  )}
                  <OptionText q={q} o={o} />
                </>
              ) : (
                <div className="flex flex-col gap-6">
                  <SectionHead
                    eyebrow={n > 1 ? `Question ${i + 1} of ${n}` : undefined}
                    title={q.title || page.q}
                    blurb={q.intro ? <Html as="p" html={q.intro} /> : undefined}
                  />
                  {q.options.map((x) => (
                    <div key={x.id} className="flex flex-col gap-2.5">
                      <OptionText q={q} o={x} />
                      <Stage o={x} />
                    </div>
                  ))}
                </div>
              )
            }
            shots={beside ? <Stage o={o} /> : undefined}
            answer={
              <>
                {beside ? (
                  <>
                    <h2 className="m-0 text-base leading-snug font-medium text-pretty">
                      {q.title || page.q}
                    </h2>
                    {q.intro && (
                      <Html
                        as="p"
                        html={q.intro}
                        className="text-sm text-muted-foreground"
                      />
                    )}
                  </>
                ) : (
                  <Label className="mt-4">
                    {live ? "Your answer" : "Outcome"}
                  </Label>
                )}
                <Answer
                  r={r}
                  q={q}
                  live={live}
                  {...pickProps}
                  onPick={signoff(q) ? undefined : (id) => view(q, id)}
                />
              </>
            }
          />
        )
      })}
      {about && <div className="hidden xl:block">{nav}</div>}
    </DetailLayout>
  )
}

/** The answer to a question: its options as the chat card's choice rows. */
function Answer({
  r,
  q,
  live,
  picks,
  pick,
  sent,
  chatOnly,
  onPick,
}: {
  r: Round
  q: Question
  live: boolean
  onPick?: (id: string) => void
} & PickProps) {
  if (!live)
    return <p className="m-0 text-sm text-muted-foreground">{outcomeOf(q)}</p>
  return (
    <>
      <Choices
        name={`answer-r${r.n}-${q.key}`}
        value={picks[q.key]}
        onChange={(v) => {
          if (sent === q.key) return
          pick(q.key, v)
          onPick?.(v)
        }}
        choices={
          signoff(q)
            ? SIGN.map(([value, label]) => ({ value, label }))
            : q.options.map((o) => ({
                value: o.id,
                label: `${o.id} · ${o.name}`,
                rec: o.rec,
              }))
        }
      />
      {chatOnly === q.key && <AnswerInChat />}
    </>
  )
}

const outcomeOf = (q: Question) => {
  const o = q.options.find((x) => x.state === "picked")
  if (!o) return "No pick"
  return signoff(q) ? "Signed off" : `Picked ${o.id} · ${o.name}`
}

/** The feedback that started the round and what every option shares. */
function About({ r, live }: { r: Round; live: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Intro
        meta={`Round ${r.n} · ${live ? "open" : outcome(r)}`}
        quote={r.feedback ? <Html as="span" html={r.feedback} /> : undefined}
      />
      {r.every && (
        <section className="flex flex-col gap-2">
          <Label>In every option</Label>
          <Facts items={r.every} />
        </section>
      )}
    </div>
  )
}

/** An option's name, why and cost. */
function OptionText({ q, o }: { q: Question; o: Option }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ItemHead id={signoff(q) ? undefined : o.id} title={o.name} large />
        {o.rec && <Rec />}
        {o.state === "picked" && <Tag tone="done">Picked</Tag>}
        {o.state === "rejected" && <Tag tone="no">Rejected</Tag>}
      </div>
      {o.why && <Html as="p" html={o.why} className="max-w-[72ch] text-sm" />}
      {o.cost && (
        <p className="m-0 max-w-[72ch] text-sm text-muted-foreground">
          <b className="font-medium text-foreground">Cost</b>{" "}
          <Html as="span" html={o.cost} />
        </p>
      )}
    </>
  )
}

/** Captures sit on a muted stage, so a screenshot of a page never reads as part of this one. */
function Stage({ o }: { o: Option }) {
  if (!o.shots?.length && !o.html) return null
  return (
    <div className="flex min-w-0 flex-col items-center gap-4 bg-muted px-4 py-5 md:px-8 md:py-8">
      {o.html && <Html as="div" html={o.html} />}
      <Shots
        list={o.shots}
        className={
          "w-full items-center" + (o.state === "rejected" ? " opacity-55" : "")
        }
      />
    </div>
  )
}

// Option letters: a dot marks the recommendation, a tick the pick
function Mark({ o, mine }: { o: Option; mine: boolean }) {
  if (mine || o.state === "picked")
    return (
      <CheckIcon
        aria-label={mine ? "your pick" : "picked"}
        className="size-3.5 text-success"
      />
    )
  if (o.state === "rejected")
    return <XIcon aria-label="rejected" className="size-3.5 text-destructive" />
  if (o.rec) return <RecDot />
  return null
}
