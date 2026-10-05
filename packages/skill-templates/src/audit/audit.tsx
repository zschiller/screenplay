// The design-audit findings page: header, filter tabs (All / Calls / one per
// depth), then one card per finding with its captures and its pick: Fix or
// Skip, or a call's options drawn like the chat's question card. Each pick
// starts on the recommendation, in grey. From 1280px it's list and detail
// (shared/detail.tsx): every finding listed on the left, one at a time in the
// middle, its pick pinned on the right. A bar pinned to the bottom carries
// the tally, a note and Copy (Send to chat on a canvas, where a call the chat
// asks about with a question card answers that card).

import * as React from "react"

import { useSharedState } from "@screenplay.space/state"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"

import { cn } from "@workspace/ui/lib/utils"

import {
  answer,
  askedId,
  answersInChat,
  canAnswer,
  cardIndex,
  useCardQuestion,
} from "../shared/chat.ts"
import { AnswerInChat, Choices } from "../shared/choices.tsx"
import {
  Fold,
  FoldList,
  Intro,
  ItemHead,
  ItemNote,
  Links,
  PAIR,
  SectionHead,
  Segmented,
  Shell,
  type Tab,
  Tag,
} from "../shared/kit.tsx"
import {
  ABOUT,
  DEFAULTED,
  DetailItem,
  DetailLayout,
  DetailNav,
  detailOnly,
  useDetail,
} from "../shared/detail.tsx"
import { CopyBar, Html, load, store } from "../shared/page.tsx"
import { Shots, type Img } from "../shared/shots.tsx"
import { useTheme } from "../shared/theme.tsx"

export type Page = {
  title: string
  date: string
  slug: string
  lede: string[]
  links?: [string, string][]
}
export type Depth = { key: string; name: string; blurb: string }
export type Notice = { title: string; body: string }
export type Finding = {
  id: string
  sev: "high" | "med" | "low"
  title: string
  wrong: string
  evidence?: string[]
  fix: string
  shots?: Img[]
  call?: { q: string; options: { id: string; label: string; rec?: boolean }[] }
  pend?: { tag: string; why: string }
  still?: string
  related?: string
}
export type Extra = [string, string[]]

const SEV = { high: "High", med: "Medium", low: "Low" }
const SEV_TONE = { high: "high", med: "medium", low: "plain" } as const

type State = {
  picks: Record<string, string>
  notes: Record<string, string>
  note: string
}

export function Audit({
  page,
  depths,
  notices,
  findings,
  extra,
}: {
  page: Page
  depths: Depth[]
  notices: Notice[]
  findings: Finding[]
  extra: Extra[]
}) {
  const dark = useTheme()
  const KEY = "audit-" + page.slug
  const [state, setState] = React.useState<State>(() => {
    const s = load<State>(KEY)
    return { picks: s.picks || {}, notes: s.notes || {}, note: s.note || "" }
  })
  React.useEffect(() => store(KEY, state), [KEY, state])
  const [noteOpen, setNoteOpen] = React.useState(!!state.note)
  const [filter, setFilter] = React.useState("all")
  // On a Screenplay canvas, every viewer sees the same picks, notes and
  // filter (@screenplay.space/state; inert anywhere else)
  useSharedState("audit", state, setState)
  useSharedState("filter", filter, setFilter)

  const calls = findings.filter((f) => f.call)
  // The call the chat's open question card asks about, on a canvas
  const card = useCardQuestion()
  const asked = askedId(
    card,
    Object.fromEntries(
      calls.map((f) => [f.id, f.call!.options.map((o) => o.label)])
    )
  )
  const askedCall = asked ? findings.find((f) => f.id === asked) : undefined
  // An answer on the card (from here, the chat or anyone) is that call's pick
  const answeredOption =
    card && askedCall && card.answer?.index != null
      ? askedCall.call!.options.find(
          (_, i, all) =>
            cardIndex(
              card,
              all.map((o) => o.label),
              i
            ) === card.answer!.index
        )?.id
      : undefined
  React.useEffect(() => {
    if (!asked || !answeredOption) return
    setState((s) =>
      s.picks[asked] === answeredOption
        ? s
        : { ...s, picks: { ...s.picks, [asked]: answeredOption } }
    )
  }, [asked, answeredOption])
  const recOf = (f: Finding) => f.call?.options.find((o) => o.rec)
  const pick = (id: string, v: string) =>
    setState((s) => {
      const picks = { ...s.picks }
      if (picks[id] === v) delete picks[id]
      else picks[id] = v
      return { ...s, picks }
    })
  // While the page can't answer the card (it's live, or the agent drives it), its pick stays here
  const chatOnly = answersInChat(card) ? asked : null
  // A call's option, chosen on the page: answers the chat's card too when
  // it's the call the card asks about and the option is one of the card's
  const choose = (f: Finding, v: string) => {
    if (f.id === asked && canAnswer(card)) {
      const labels = f.call!.options.map((o) => o.label)
      const i = f.call!.options.findIndex((o) => o.id === v)
      const at = i < 0 ? -1 : cardIndex(card, labels, i)
      if (at >= 0) answer(at)
    }
    setState((s) => ({ ...s, picks: { ...s.picks, [f.id]: v } }))
  }
  const label = (f: Finding, v: string) => {
    if (v === "fix") return "Fix"
    if (v === "skip") return "Skip"
    const o = f.call!.options.find((o) => o.id === v)!
    return `${o.id}: ${o.label}`
  }
  const text = () => {
    const { picks, notes, note } = state
    const L = [`${page.title} (${page.date}): picks`]
    const fix = findings
      .filter((f) => !f.call && picks[f.id] === "fix")
      .map((f) => f.id)
    const skip = findings.filter((f) => picks[f.id] === "skip").map((f) => f.id)
    if (fix.length) L.push("Fix: " + fix.join(", "))
    if (skip.length) L.push("Skip: " + skip.join(", "))
    const answered = calls.filter((f) => picks[f.id] && picks[f.id] !== "skip")
    if (answered.length) {
      L.push("Calls:")
      answered.forEach((f) => L.push(`  ${f.id} → ${label(f, picks[f.id]!)}`))
    }
    const open = findings.filter((f) => !picks[f.id])
    const stands = open.filter((f) => !f.call || recOf(f))
    const asks = open.filter((f) => f.call && !recOf(f))
    if (stands.length)
      L.push(
        "Unpicked, recommendation stands: " +
          stands
            .map((f) => (f.call ? `${f.id} (${recOf(f)!.id})` : f.id))
            .join(", ")
      )
    if (asks.length)
      L.push(
        "Unanswered calls with no recommendation: " +
          asks.map((f) => f.id).join(", ")
      )
    const noted = findings.filter((f) => (notes[f.id] || "").trim())
    if (noted.length) {
      L.push("Notes:")
      noted.forEach((f) => L.push(`  ${f.id}: ${notes[f.id]!.trim()}`))
    }
    if (note.trim()) L.push("Note: " + note.trim())
    return L.join("\n")
  }
  // Every pick starts on the recommendation, so the tally counts changes
  const rec = (f: Finding) => (f.call ? recOf(f)?.id : "fix")
  const changed = findings.filter(
    (f) => state.picks[f.id] && state.picks[f.id] !== rec(f)
  ).length
  const need = findings.filter((f) => !rec(f) && !state.picks[f.id]).length
  const status = (
    <>
      <b>{changed}</b> changed
      <span className="max-sm:hidden">
        {" "}
        · {findings.length - changed - need} keep my recommendation
      </span>
      {need > 0 && (
        <>
          {" "}
          · <b>{need}</b> need you
        </>
      )}
    </>
  )

  const tabs: Tab[] = [
    { value: "all", label: "All", count: findings.length },
    { value: "calls", label: "Calls", count: calls.length },
    ...depths.map((d) => ({
      value: d.key,
      label: d.name,
      count: findings.filter((f) => f.id[0] === d.key).length,
    })),
  ]
  const shows = (f: Finding) =>
    filter === "all" || (filter === "calls" ? !!f.call : f.id[0] === filter)
  const detail = useDetail(
    findings.filter(shows).map((f) => f.id),
    {
      asked: card?.answer ? null : asked,
    }
  )
  const about = detail.sel === ABOUT

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
          status={status}
          note={state.note}
          setNote={(note) => setState((s) => ({ ...s, note }))}
          noteOpen={noteOpen}
          setNoteOpen={setNoteOpen}
          copyLabel="Copy picks"
          fallbackLabel="Select and copy"
          outLabel="Picks to copy"
          text={text}
          send
        />
      }
    >
      <DetailLayout
        about="About this audit"
        detail={detail}
        groups={depths.map((d) => ({
          name: d.name,
          items: findings
            .filter((f) => f.id[0] === d.key && shows(f))
            .map((f) => ({
              id: f.id,
              title: f.title,
              done: !!state.picks[f.id],
            })),
        }))}
      >
        <Intro
          meta={`Design audit · ${page.date}`}
          className={detailOnly(about)}
        >
          {page.lede.map((l, i) => (
            <Html as="p" key={i} html={l} />
          ))}
          <Links links={page.links ?? []} />
        </Intro>
        {notices.map((x, i) => (
          <div key={i} className={detailOnly(about)}>
            <Notice title={x.title} body={x.body} />
          </div>
        ))}
        {depths.map((d) => (
          <section
            key={d.key}
            hidden={!findings.some((f) => f.id[0] === d.key && shows(f))}
            className={cn("flex flex-col", detailOnly(detail.sel[0] === d.key))}
          >
            <div className="xl:hidden">
              <SectionHead title={d.name} blurb={d.blurb} />
            </div>
            {findings
              .filter((f) => f.id[0] === d.key)
              .map((f) => (
                <FindingCard
                  key={f.id}
                  f={f}
                  hidden={!shows(f)}
                  shown={detail.sel === f.id}
                  nav={<DetailNav detail={detail} noun="findings" />}
                  rec={rec(f)}
                  picked={state.picks[f.id]}
                  pick={pick}
                  choose={choose}
                  chatOnly={chatOnly === f.id}
                  note={state.notes[f.id] || ""}
                  setNote={(v) =>
                    setState((s) => ({
                      ...s,
                      notes: { ...s.notes, [f.id]: v },
                    }))
                  }
                />
              ))}
          </section>
        ))}
        {filter === "all" && extra.length > 0 && (
          <div className={cn("flex flex-col gap-3", detailOnly(about))}>
            {extra.map(([t, items]) => (
              <Fold key={t} title={t}>
                <FoldList items={items} />
              </Fold>
            ))}
          </div>
        )}
        {about && (
          <div className="hidden xl:block">
            <DetailNav detail={detail} noun="findings" />
          </div>
        )}
      </DetailLayout>
    </Shell>
  )
}

/** Work in flight that may change findings: an outlined warning. */
function Notice({ title, body }: { title: string; body: string }) {
  return (
    <Alert role="note" className="border-warning">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <Html as="span" html={body} />
      </AlertDescription>
    </Alert>
  )
}

function FindingCard({
  f,
  hidden,
  shown,
  nav,
  rec,
  picked,
  pick,
  choose,
  chatOnly,
  note,
  setNote,
}: {
  f: Finding
  hidden: boolean
  /** The finding list and detail shows */
  shown: boolean
  nav: React.ReactNode
  /** The recommended pick, shown in grey until someone picks */
  rec?: string
  picked?: string
  pick: (id: string, v: string) => void
  choose: (f: Finding, v: string) => void
  /** The chat's open card asks this call, and a pick here can't answer it. */
  chatOnly: boolean
  note: string
  setNote: (v: string) => void
}) {
  return (
    <DetailItem
      id={f.id.toLowerCase()}
      open={!picked}
      hidden={hidden}
      shown={shown}
      nav={nav}
      head={
        <>
          <ItemHead id={f.id} title={f.title} />
          <div className="flex flex-wrap gap-1.5">
            <Tag tone={SEV_TONE[f.sev]}>{SEV[f.sev]}</Tag>
            {f.call && <Tag>Call</Tag>}
            {f.call && !rec && !picked && (
              <Tag className="text-foreground">Needs you</Tag>
            )}
            {f.pend && <Tag tone="medium">{f.pend.tag}</Tag>}
            {f.still && <Tag>{f.still}</Tag>}
            {f.related && <Tag>Related {f.related}</Tag>}
          </div>
          <Html as="p" html={f.wrong} className="max-w-[72ch] text-sm" />
          {f.evidence?.length ? (
            <Fold title="Evidence">
              <ul className="m-0 pl-4.5 text-xs text-muted-foreground">
                {f.evidence.map((e) => (
                  <li key={e}>
                    <code className="font-mono [overflow-wrap:anywhere]">
                      {e}
                    </code>
                  </li>
                ))}
              </ul>
            </Fold>
          ) : null}
          <p className="max-w-[72ch] text-sm">
            <b className="font-semibold">Fix.</b>{" "}
            <Html as="span" html={f.fix} />
          </p>
          {f.pend && <Notice title={f.pend.tag} body={f.pend.why} />}
        </>
      }
      shots={f.shots?.length ? <Shots list={f.shots} className={PAIR} /> : null}
      answer={
        f.call ? (
          <>
            <Html
              as="p"
              html={f.call.q}
              className="mt-1 max-w-[72ch] text-sm font-medium lg:mt-0"
            />
            <ItemNote
              label={`Note on ${f.id}`}
              note={note}
              setNote={setNote}
              stacked
            >
              <div className={cn("contents", !picked && rec && DEFAULTED)}>
                <Choices
                  name={`pick-${f.id}`}
                  value={picked ?? rec}
                  onChange={(v) => choose(f, v)}
                  choices={[
                    ...f.call.options.map((o) => ({
                      value: o.id,
                      label: `${o.id} · ${o.label}`,
                      rec: o.rec,
                    })),
                    { value: "skip", label: "Skip", quiet: true },
                  ]}
                />
              </div>
              {chatOnly && <AnswerInChat />}
            </ItemNote>
          </>
        ) : (
          <ItemNote label={`Note on ${f.id}`} note={note} setNote={setNote}>
            <Segmented
              aria-label={`Pick for ${f.id}`}
              value={picked ?? "fix"}
              // Pressing the grey Fix picks it; pressing a pick again clears it
              onChange={(v) => pick(f.id, v || picked || "fix")}
              items={[
                { value: "fix", label: "Fix" },
                { value: "skip", label: "Skip" },
              ]}
              className={picked ? undefined : DEFAULTED}
            />
          </ItemNote>
        )
      }
    />
  )
}
