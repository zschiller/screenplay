// The design-exploration page. Phone first, one column at every width: round
// tabs under the question, in time order (Today, Round 1, Round 2…) and
// opening on the newest; each question shows one option at a time behind a
// segmented A/B/C control that sticks to the top while you read. A bar pinned
// to the bottom carries the picks, a note and Copy.

import * as React from "react"
import { flushSync } from "react-dom"

import { useSharedState } from "@screenplay.space/state"

import { Button } from "@workspace/ui/components/button"
import { CheckIcon, XIcon } from "@workspace/ui/components/icons"
import { TabsContent } from "@workspace/ui/components/tabs"

import {
  answer as answerCard,
  type CardQuestion,
  onCanvas,
  useCardQuestion,
} from "../shared/chat.ts"
import {
  Fold,
  Intro,
  ItemHead,
  Quote,
  Rec,
  RecDot,
  SectionHead,
  Segmented,
  Shell,
  Tag,
} from "../shared/kit.tsx"
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
  const pickProps = { picks, pick, sent: answered ? linked!.q.key : undefined }

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
        />
      }
    >
      <Intro meta={`Design exploration · ${page.date}`} quote={page.quote} />
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

function RoundPanel({
  round: r,
  live,
  ...pickProps
}: { round: Round; live: boolean } & PickProps) {
  return (
    <section className="flex min-w-0 flex-col gap-10">
      {(r.feedback || r.every) && (
        // What started the round and what its options share, folded so the options come first
        <div className="-mb-4 flex flex-col gap-2">
          <Label>
            Round {r.n} · {live ? "open" : outcome(r)}
          </Label>
          <Fold title={r.feedback ? "Your feedback" : "In every option"}>
            <div className="flex flex-col gap-3.5">
              {r.feedback && (
                <Quote>{<Html as="span" html={r.feedback} />}</Quote>
              )}
              {r.every && (
                <>
                  {r.feedback && <Label>In every option</Label>}
                  <Facts items={r.every} />
                </>
              )}
            </div>
          </Fold>
        </div>
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
    </section>
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
    if (!id) return
    flushSync(() => setOpt(id))
    // When the letters are stuck to the top, start the new option from its beginning
    const b = bar.current!
    const stuck =
      b.getBoundingClientRect().top <= parseFloat(getComputedStyle(b).top) + 1
    const panel = root.current!.querySelector(
      ":scope>[data-option]:not([hidden])"
    )
    if (stuck && panel)
      scrollTo({
        top: scrollY + panel.getBoundingClientRect().top - b.offsetHeight - 12,
        behavior: "instant",
      })
  }
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
  return (
    <div ref={root} className="flex min-w-0 flex-col gap-4">
      {(q.title || n > 1) && (
        <SectionHead
          eyebrow={n > 1 ? `Question ${i + 1} of ${n}` : undefined}
          title={q.title || undefined}
          blurb={q.intro ? <Html as="p" html={q.intro} /> : undefined}
        />
      )}
      {signoff(q) ? (
        card(q.options[0]!)
      ) : (
        <>
          {/* Stuck, the letters keep a page-coloured margin so content never shows around their corners */}
          <div
            ref={bar}
            className="sticky top-[calc(env(safe-area-inset-top,0px)+var(--top-bar,0px)+8px)] z-[5] bg-background shadow-[0_0_0_8px_var(--background)]"
          >
            <Segmented
              aria-label="Options"
              value={opt}
              onChange={choose}
              items={q.options.map((o) => ({
                value: o.id,
                label: (
                  <>
                    <span className="font-mono font-semibold">{o.id}</span>
                    <Mark o={o} mine={live && picks[q.key] === o.id} />
                  </>
                ),
              }))}
              className="flex w-full"
              itemClassName="flex-1"
            />
          </div>
          {q.options.map((o) => (
            <div key={o.id} data-option hidden={opt !== o.id}>
              {card(o)}
            </div>
          ))}
        </>
      )}
    </div>
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
  const mine = picks[q.key]
  return (
    <article className="flex min-w-0 flex-col gap-3">
      <ItemHead id={signoff(q) ? undefined : o.id} title={o.name} large />
      {(o.rec || o.state) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {o.rec && <Rec />}
          {o.state === "picked" && <Tag tone="done">Picked</Tag>}
          {o.state === "rejected" && <Tag tone="no">Rejected</Tag>}
        </div>
      )}
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
          {signoff(q) ? (
            <Segmented
              aria-label="Sign off"
              value={mine ?? ""}
              onChange={(v) => !sent && pick(q.key, v || mine!)}
              items={SIGN.map(([value, label]) => ({ value, label }))}
            />
          ) : (
            <Button
              type="button"
              variant={mine === o.id ? "default" : "outline"}
              aria-pressed={mine === o.id}
              disabled={!!sent && mine !== o.id}
              onClick={() => pick(q.key, o.id)}
            >
              {mine === o.id ? `Picked ${o.id}` : `Pick ${o.id}`}
            </Button>
          )}
        </div>
      )}
    </article>
  )
}
