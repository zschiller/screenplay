// The design-audit findings page. Phone first, one column: header, filter
// tabs (All / Calls / one per depth), then one card per finding with its
// captures and its pick row. A bar pinned to the bottom carries the tally, a
// note and Copy.

import * as React from "react"
import { flushSync } from "react-dom"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@workspace/ui/components/collapsible"
import { CaretRightIcon, CheckIcon } from "@workspace/ui/components/icons"
import { Textarea } from "@workspace/ui/components/textarea"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import { cn } from "@workspace/ui/lib/utils"

import { CopyBar, Html, Label, load, store } from "../shared/page.tsx"
import { Lightbox, Shots, type Img } from "../shared/shots.tsx"
import { ThemeButton, ThemeContext, useTheme } from "../shared/theme.tsx"

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
const SEV_TEXT = { high: "text-destructive", med: "text-warning", low: "" }

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
  const [dark, toggleTheme] = useTheme()
  const KEY = "audit-" + page.slug
  const [state, setState] = React.useState<State>(() => {
    const s = load<State>(KEY)
    return { picks: s.picks || {}, notes: s.notes || {}, note: s.note || "" }
  })
  React.useEffect(() => store(KEY, state), [KEY, state])
  const [noteOpen, setNoteOpen] = React.useState(!!state.note)
  const [filter, setFilter] = React.useState("all")

  const calls = findings.filter((f) => f.call)
  const recOf = (f: Finding) => f.call?.options.find((o) => o.rec)
  const pick = (id: string, v: string) =>
    setState((s) => {
      const picks = { ...s.picks }
      if (picks[id] === v) delete picks[id]
      else picks[id] = v
      return { ...s, picks }
    })
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
  const n = (v: string) =>
    findings.filter((f) => state.picks[f.id] === v).length
  const picked = findings.filter(
    (f) => state.picks[f.id] && state.picks[f.id] !== "skip"
  ).length
  const status = (
    <>
      <b>{picked}</b> picked · <b>{n("skip")}</b> skipped ·{" "}
      {calls.filter((f) => state.picks[f.id]).length} of {calls.length} calls ·{" "}
      {findings.filter((f) => !state.picks[f.id]).length} left
    </>
  )

  const tabs: [string, string][] = [
    ["all", "All · " + findings.length],
    ["calls", "Calls · " + calls.length],
    ...depths.map((d): [string, string] => [
      d.key,
      `${d.name} · ${findings.filter((f) => f.id[0] === d.key).length}`,
    ]),
  ]
  const shows = (f: Finding) =>
    filter === "all" || (filter === "calls" ? !!f.call : f.id[0] === filter)

  return (
    <ThemeContext.Provider value={dark}>
      <Lightbox>
        <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-4 pt-6 pb-[calc(112px+env(safe-area-inset-bottom,0px))] md:px-6 md:pt-10">
          <header>
            <div className="flex items-center justify-between gap-3">
              <Label accent>Design audit · {page.date}</Label>
              <ThemeButton dark={dark} toggle={toggleTheme} />
            </div>
            <h1 className="mt-2 mb-2.5 font-heading text-title-xl text-balance">
              {page.title}
            </h1>
            <div className="flex max-w-[72ch] flex-col gap-2 text-sm text-muted-foreground">
              {page.lede.map((l, i) => (
                <Html as="p" key={i} html={l} />
              ))}
              {page.links?.length ? (
                <p>
                  {page.links.map(([t, u], i) => (
                    <React.Fragment key={u}>
                      {i > 0 && " · "}
                      <a href={u} className="text-foreground underline">
                        {t}
                      </a>
                    </React.Fragment>
                  ))}
                </p>
              ) : null}
            </div>
          </header>
          <nav
            aria-label="Filter"
            className="sticky top-[env(safe-area-inset-top,0px)] z-[6] -mx-4 [scrollbar-width:none] overflow-x-auto border-b bg-background px-4 py-2 md:-mx-6 md:px-6 [&::-webkit-scrollbar]:hidden"
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
          </nav>
          {notices.map((x, i) => (
            <Alert key={i} role="note" className="border-warning">
              <AlertTitle>{x.title}</AlertTitle>
              <AlertDescription>
                <Html as="span" html={x.body} />
              </AlertDescription>
            </Alert>
          ))}
          {depths.map((d) => (
            <React.Fragment key={d.key}>
              {(filter === "all" || filter === d.key) && (
                <div className="mt-2 flex flex-col gap-1 border-b border-foreground pb-2.5">
                  <h2 className="m-0 font-heading text-title-md text-balance">
                    {d.name}
                  </h2>
                  <p className="text-sm text-muted-foreground">{d.blurb}</p>
                </div>
              )}
              {findings
                .filter((f) => f.id[0] === d.key)
                .map((f) => (
                  <FindingCard
                    key={f.id}
                    f={f}
                    hidden={!shows(f)}
                    picked={state.picks[f.id]}
                    pick={pick}
                    note={state.notes[f.id] || ""}
                    setNote={(v) =>
                      setState((s) => ({
                        ...s,
                        notes: { ...s.notes, [f.id]: v },
                      }))
                    }
                  />
                ))}
            </React.Fragment>
          ))}
          {extra.map(([t, items]) => (
            <Fold key={t} title={t} items={items} />
          ))}
        </div>
        <CopyBar
          status={status}
          note={state.note}
          setNote={(note) => setState((s) => ({ ...s, note }))}
          noteOpen={noteOpen}
          setNoteOpen={setNoteOpen}
          copyLabel="Copy picks"
          fallbackLabel="Select and copy"
          outLabel="Picks to copy"
          text={text}
          maxWidth="912px"
        />
      </Lightbox>
    </ThemeContext.Provider>
  )
}

function FindingCard({
  f,
  hidden,
  picked,
  pick,
  note,
  setNote,
}: {
  f: Finding
  hidden: boolean
  picked?: string
  pick: (id: string, v: string) => void
  note: string
  setNote: (v: string) => void
}) {
  const [noteOpen, setNoteOpen] = React.useState(!!note)
  const noteRef = React.useRef<HTMLTextAreaElement>(null)
  const choices: [string, string, boolean][] = [
    ...(f.call
      ? f.call.options.map((o): [string, string, boolean] => [
          o.id,
          `${o.id} · ${o.label}`,
          !!o.rec,
        ])
      : [["fix", "Fix", false] as [string, string, boolean]]),
    ["skip", "Skip", false],
  ]
  return (
    <article
      id={f.id.toLowerCase()}
      hidden={hidden}
      className="flex min-w-0 scroll-mt-16 flex-col gap-2.5 border-b pb-5"
    >
      <header className="flex items-baseline gap-2.5">
        <span className="flex-none font-mono text-sm font-semibold text-info">
          {f.id}
        </span>
        <h3 className="m-0 text-sm font-medium text-balance">{f.title}</h3>
      </header>
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline" className={SEV_TEXT[f.sev]}>
          {SEV[f.sev]}
        </Badge>
        {f.call && (
          <Badge variant="outline" className="text-info">
            Call
          </Badge>
        )}
        {f.pend && (
          <Badge variant="outline" className="text-warning">
            {f.pend.tag}
          </Badge>
        )}
        {f.still && <Badge variant="outline">{f.still}</Badge>}
        {f.related && <Badge variant="outline">Related {f.related}</Badge>}
      </div>
      <Html as="p" html={f.wrong} className="max-w-[72ch] text-sm" />
      {f.evidence?.length ? (
        <Collapsible className="group/ev">
          <CollapsibleTrigger className="flex cursor-pointer items-center gap-1 text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
            <CaretRightIcon className="size-3.5 transition-transform group-data-[state=open]/ev:rotate-90" />
            Evidence
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="m-0 mt-1.5 pl-4.5 text-xs text-muted-foreground">
              {f.evidence.map((e) => (
                <li key={e}>
                  <code className="font-mono [overflow-wrap:anywhere]">
                    {e}
                  </code>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
      <p className="max-w-[72ch] text-sm">
        <b className="font-semibold">Fix.</b> <Html as="span" html={f.fix} />
      </p>
      {f.pend && (
        <div className="max-w-[72ch] rounded-lg border border-warning px-3 py-2.5 text-sm">
          <b className="font-semibold">{f.pend.tag}.</b>{" "}
          <Html as="span" html={f.pend.why} />
        </div>
      )}
      {f.call && (
        <div className="max-w-[72ch] rounded-lg bg-muted px-3 py-2.5 text-sm">
          <b className="font-semibold">Call.</b>{" "}
          <Html as="span" html={f.call.q} />
        </div>
      )}
      <Shots
        list={f.shots}
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-2"
      />
      <div
        role="group"
        aria-label={`Pick for ${f.id}`}
        className="flex flex-wrap gap-2"
      >
        {choices.map(([v, l, rec]) => {
          const on = picked === v
          return (
            <Button
              key={v}
              type="button"
              size="lg"
              variant={on ? "default" : "outline"}
              aria-pressed={on}
              onClick={() => pick(f.id, v)}
            >
              {on && <CheckIcon data-icon="inline-start" />}
              {l}
              {rec && <span className={on ? "" : "text-info"}>· rec</span>}
            </Button>
          )
        })}
        <Button
          type="button"
          size="lg"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => {
            flushSync(() => setNoteOpen(!noteOpen))
            if (!noteOpen) noteRef.current?.focus()
          }}
        >
          Note
        </Button>
      </div>
      <Textarea
        ref={noteRef}
        hidden={!noteOpen}
        aria-label={`Note on ${f.id}`}
        placeholder={`Note on ${f.id}`}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="min-h-14 resize-y text-sm md:text-sm"
      />
    </article>
  )
}

/** Closing notes: checked and fine, merged, method. */
function Fold({ title, items }: { title: string; items: string[] }) {
  return (
    <Collapsible className="group/fold rounded-lg border">
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1.5 px-3.5 py-3 text-left text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
        <CaretRightIcon className="size-3.5 text-muted-foreground transition-transform group-data-[state=open]/fold:rotate-90" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3.5 pb-3.5">
        <ul
          className={cn(
            "m-0 flex flex-col gap-1 pl-4.5 text-sm text-muted-foreground"
          )}
        >
          {items.map((x, i) => (
            <Html as="li" key={i} html={x} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
