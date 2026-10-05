// The design-storybook page. Phone first, one column at every width: a bar
// pinned to the top holds the title and the tabs; the stage shows the chosen
// state; under it, a segmented control per dimension, the state's name and
// notes, a note field, and what the storybook is for. A second tab lists
// every state. A bar pinned to the bottom counts the notes and copies them,
// or on a canvas sends them to the chat's composer.

import * as React from "react"

import { useSharedState } from "@screenplay.space/state"

import { Button } from "@workspace/ui/components/button"
import { CaretLeftIcon, CaretRightIcon } from "@workspace/ui/components/icons"
import { Input } from "@workspace/ui/components/input"
import { TabsContent } from "@workspace/ui/components/tabs"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

import { Intro, Segmented, Shell } from "../shared/kit.tsx"
import { CopyBar, Html, Label, load, store } from "../shared/page.tsx"
import { Shots } from "../shared/shots.tsx"
import { useTheme } from "../shared/theme.tsx"
import type { Control, Page, Render, State, Value } from "./types.ts"

type Values = Record<string, Value>
type Notes = Record<string, string>

const fallback = (c: Control): Value =>
  c.type === "toggle"
    ? false
    : c.type === "number"
      ? 0
      : c.type === "text"
        ? ""
        : c.values![0]!

export function Storybook({
  page,
  controls,
  states,
  render,
}: {
  page: Page
  controls: Control[]
  states: State[]
  render?: Render
}) {
  const dark = useTheme()
  // Every state's full values: a missing key takes the control's default
  const full = React.useCallback(
    (set?: Values): Values =>
      Object.fromEntries(
        controls.map((c) => [
          c.key,
          set && c.key in set ? set[c.key]! : fallback(c),
        ])
      ),
    [controls]
  )
  const all = React.useMemo(
    () => states.map((s) => ({ ...s, vals: full(s.set) })),
    [states, full]
  )
  const same = (a: Values, b: Values) =>
    controls.every((c) => a[c.key] === b[c.key])
  const label = (v: Values) =>
    controls
      .map(
        (c) =>
          `${c.label} ${c.type === "toggle" ? (v[c.key] ? "on" : "off") : v[c.key] === "" ? "empty" : v[c.key]}`
      )
      .join(", ")

  const KEY = "storybook-" + page.slug
  // Notes belong to the round; a new round starts empty
  const [saved] = React.useState(() => {
    const s = load<{ round: number; notes: Notes; general: string }>(KEY)
    return s.round === page.round ? s : {}
  })
  const [vals, setVals] = React.useState<Values>(() => {
    const hash = decodeURIComponent(location.hash.slice(1))
    return (all.find((s) => s.id === hash) ?? all[0])?.vals ?? full()
  })
  const [notes, setNotes] = React.useState<Notes>(saved.notes ?? {})
  const [general, setGeneral] = React.useState(saved.general ?? "")
  const [generalOpen, setGeneralOpen] = React.useState(!!saved.general)
  const [tab, setTab] = React.useState("story")
  React.useEffect(() => {
    store(KEY, { round: page.round, notes, general })
  }, [KEY, page.round, notes, general])

  // On a Screenplay canvas, every viewer follows the same state and sees the
  // same notes (@screenplay.space/state; inert anywhere else)
  const sharedVals = React.useMemo(
    () => JSON.parse(JSON.stringify(vals)) as Values,
    [vals]
  )
  const sharedNotes = React.useMemo(
    () => JSON.parse(JSON.stringify(notes)) as Notes,
    [notes]
  )
  useSharedState("state", sharedVals, setVals)
  useSharedState("notes", sharedNotes, setNotes)
  useSharedState("general", general, setGeneral)
  useSharedState("tab", tab, setTab)

  const current = all.find((s) => same(s.vals, vals)) ?? null
  const index = current ? all.indexOf(current) : -1
  const noteKey =
    current?.id ??
    "custom:" + controls.map((c) => `${c.key}=${vals[c.key]}`).join(",")
  React.useEffect(() => {
    if (!current) return
    try {
      history.replaceState(null, "", "#" + encodeURIComponent(current.id))
    } catch {
      // A Mockup's srcdoc page can't change its URL; the state just isn't linkable
    }
  }, [current])

  // The stage keeps one height for every state, so nothing above the controls
  // moves: the tallest capture at the stage's width, and on a wide screen no
  // taller than leaves the controls and the state's name on the first screen
  const stageRef = React.useRef<HTMLDivElement>(null)
  const controlsRef = React.useRef<HTMLDivElement>(null)
  const nameRef = React.useRef<HTMLDivElement>(null)
  const [ratio, setRatio] = React.useState(0)
  React.useEffect(() => {
    let live = true
    const srcs = all.flatMap((s) =>
      s.shots ? [dark && s.shots.dk ? s.shots.dk : s.shots.p] : []
    )
    Promise.all(
      srcs.map(
        (src) =>
          new Promise<number>((done) => {
            const img = new Image()
            img.onload = () =>
              done(img.naturalWidth ? img.naturalHeight / img.naturalWidth : 0)
            img.onerror = () => done(0)
            img.src = src
          })
      )
    ).then((r) => live && setRatio(Math.max(0, ...r)))
    return () => {
      live = false
    }
  }, [all, dark])
  const [box, setBox] = React.useState({ width: 0, room: Infinity })
  React.useLayoutEffect(() => {
    const measure = () => {
      const stage = stageRef.current
      if (!stage) return
      const bar = document.getElementById("copy-bar")?.offsetHeight ?? 0
      const below =
        (controlsRef.current?.offsetHeight ?? 0) +
        (nameRef.current?.offsetHeight ?? 0) +
        16 * 3 + // the gaps, and room above the bar
        bar
      const top = stage.getBoundingClientRect().top + scrollY
      setBox({
        width: stage.clientWidth,
        room: matchMedia("(min-width: 48rem)").matches
          ? Math.max(240, innerHeight - top - below)
          : Infinity,
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (stageRef.current) ro.observe(stageRef.current)
    addEventListener("resize", measure)
    return () => {
      ro.disconnect()
      removeEventListener("resize", measure)
    }
  }, [tab])
  const stageHeight =
    ratio && box.width
      ? Math.round(Math.min(box.width * ratio, box.room))
      : undefined

  const go = (s?: { vals: Values }) => s && setVals({ ...s.vals })
  const step = (d: number) => go(all[(index + d + all.length) % all.length])
  // Arrow keys step through the states, except while typing
  React.useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest("input,textarea,[contenteditable],[role=dialog]")) return
      if (e.key === "ArrowLeft") step(-1)
      if (e.key === "ArrowRight") step(1)
    }
    addEventListener("keydown", on)
    return () => removeEventListener("keydown", on)
  })

  // Captured: a value lands on the closest state that has it. Live: any combination renders.
  const choose = (c: Control, v: Value) => {
    const next = { ...vals, [c.key]: v }
    if (render) return setVals(next)
    const score = (s: { vals: Values }) =>
      controls.filter((o) => s.vals[o.key] === next[o.key]).length
    go(
      all
        .filter((s) => s.vals[c.key] === v)
        .sort((a, b) => score(b) - score(a))[0]
    )
  }
  const reachable = (c: Control, v: Value) =>
    !!render ||
    all.some(
      (s) =>
        s.vals[c.key] === v &&
        controls.every((o) => o === c || s.vals[o.key] === vals[o.key])
    )

  const setNote = (text: string) => {
    const next = { ...notes }
    if (text.trim()) next[noteKey] = text
    else delete next[noteKey]
    setNotes(next)
  }
  const noted = Object.keys(notes).filter((k) => notes[k]!.trim())
  const text = () => {
    const lines = noted.map((k) => {
      const s = all.find((x) => x.id === k)
      return `→ ${s ? s.name : "Custom"} (${s ? label(s.vals) : k.slice(7)}): ${notes[k]!.trim()}`
    })
    return [
      `Storybook: ${page.title}` +
        (page.round > 1 ? ` · Round ${page.round}` : ""),
      ...(lines.length ? lines : ["No notes on states"]),
    ]
      .concat(general.trim() ? [`General: ${general.trim()}`] : [])
      .join("\n")
  }
  const status =
    (noted.length
      ? `${noted.length} ${noted.length === 1 ? "note" : "notes"}`
      : "No notes yet") + (general.trim() ? " · general note" : "")

  return (
    <Shell
      title={page.title}
      tabs={[
        { value: "story", label: "Story" },
        { value: "all", label: "All states", count: all.length },
      ]}
      tab={tab}
      setTab={setTab}
      tabsLabel="View"
      dark={dark}
      bar={
        <CopyBar
          status={status}
          note={general}
          setNote={setGeneral}
          noteOpen={generalOpen}
          setNoteOpen={setGeneralOpen}
          copyLabel="Copy notes"
          outLabel="Notes to copy"
          text={text}
          send
        />
      }
    >
      <TabsContent value="story" className="flex min-w-0 flex-col gap-4">
        <Stage
          state={current}
          caption={label(vals)}
          render={render}
          vals={vals}
          dark={dark}
          height={stageHeight}
          stageRef={stageRef}
        />
        <div ref={controlsRef} className="flex flex-col gap-3">
          {/* Controls sit right under the stage, above the text that changes per state, so they never move as you tap. */}
          {controls.map((c) => (
            <ControlRow
              key={c.key}
              control={c}
              value={vals[c.key]!}
              choose={(v) => choose(c, v)}
              reachable={(v) => reachable(c, v)}
            />
          ))}
        </div>
        <div ref={nameRef} className="flex items-center gap-2">
          <h2 className="min-w-0 flex-1 text-lg font-medium text-balance">
            {current ? current.name : label(vals)}
          </h2>
          <span className="font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {current ? `${index + 1} of ${all.length}` : "Custom"}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Previous state"
            onClick={() => step(-1)}
          >
            <CaretLeftIcon />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="Next state"
            onClick={() => step(1)}
          >
            <CaretRightIcon />
          </Button>
        </div>
        {current?.why && (
          <Html as="p" html={current.why} className="max-w-[72ch] text-sm" />
        )}
        {current?.said && (
          <Html
            as="blockquote"
            html={"Earlier: " + current.said}
            className="m-0 max-w-[68ch] border-l-2 pl-3 text-sm text-muted-foreground"
          />
        )}
        <label className="flex flex-col gap-1.5">
          <Label>Note on this state</Label>
          <Textarea
            id="state-note"
            placeholder="What should change here"
            value={notes[noteKey] ?? ""}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-18 resize-y text-sm md:text-sm"
          />
        </label>
        <About page={page} />
      </TabsContent>
      <TabsContent value="all" className="flex flex-col gap-6">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {all.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={s === current}
              onClick={() => {
                go(s)
                setTab("story")
                scrollTo({ top: 0 })
              }}
              className="group flex flex-col gap-1.5 text-left outline-none"
            >
              <span
                className={cn(
                  "grid aspect-[4/3] place-items-center overflow-hidden border bg-muted p-2 group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
                  s === current && "border-foreground"
                )}
              >
                {s.shots && (
                  <img
                    src={dark && s.shots.dk ? s.shots.dk : s.shots.p}
                    alt=""
                    className="max-h-full max-w-full object-contain"
                  />
                )}
              </span>
              <span className="flex items-baseline gap-1.5 text-sm">
                {notes[s.id]?.trim() && (
                  <span
                    aria-label="has a note"
                    className="size-1.5 flex-none -translate-y-px rounded-full bg-foreground"
                  />
                )}
                {s.name}
              </span>
            </button>
          ))}
        </div>
        <About page={page} />
      </TabsContent>
    </Shell>
  )
}

/** The chosen state: its capture in the viewer's theme, or the live part. */
function Stage({
  state,
  caption,
  render,
  vals,
  dark,
  height,
  stageRef,
}: {
  state: State | null
  caption: string
  render?: Render
  vals: Values
  dark: boolean
  /** One height for every state; the capture fits inside it, centred */
  height?: number
  stageRef: React.Ref<HTMLDivElement>
}) {
  const live = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    if (render && live.current)
      render({ ...vals }, live.current, { theme: dark ? "dark" : "light" })
  }, [render, vals, dark])
  if (render)
    return (
      <div ref={stageRef} className="border bg-muted p-2 md:p-4">
        <div ref={live} className="w-full" />
      </div>
    )
  return (
    <div
      ref={stageRef}
      style={height ? { height } : undefined}
      className="grid min-w-0 place-items-center"
    >
      {state?.shots ? (
        <Shots
          list={[{ ...state.shots, cap: caption, bare: true }]}
          // The capture keeps its shape: as wide as the stage, or less when the stage's height holds it
          className="max-h-full max-w-full [&_button]:max-h-full [&_figure]:max-h-full [&_img]:max-h-(--stage-img) [&_img]:w-auto [&_img]:max-w-full"
          style={
            height
              ? ({ "--stage-img": `${height - 2}px` } as React.CSSProperties)
              : undefined
          }
        />
      ) : (
        <div className="grid size-full min-h-40 place-items-center border bg-muted p-4 text-sm text-muted-foreground">
          No capture for this state
        </div>
      )}
    </div>
  )
}

/** What the storybook is for, under the work: the owner's words and where the part lives. */
function About({ page }: { page: Page }) {
  return (
    <Intro
      meta={
        `Design storybook · ${page.date}` +
        (page.round > 1 ? ` · Round ${page.round}` : "")
      }
      quote={page.quote}
      className="border-t pt-4"
    >
      {page.where && <Html as="p" html={page.where} />}
    </Intro>
  )
}

/** One dimension: a segmented control, or a field for a live free value. */
function ControlRow({
  control: c,
  value,
  choose,
  reachable,
}: {
  control: Control
  value: Value
  choose: (v: Value) => void
  reachable: (v: Value) => boolean
}) {
  const id = `control-${c.key}`
  if (c.type === "text" || c.type === "number")
    return (
      <label className="flex flex-col gap-1.5">
        <Label>{c.label}</Label>
        <Input
          id={id}
          type={c.type}
          value={String(value)}
          onChange={(e) =>
            choose(
              c.type === "number" ? Number(e.target.value) : e.target.value
            )
          }
        />
      </label>
    )
  const options: [Value, string][] =
    c.type === "toggle"
      ? [
          [false, "Off"],
          [true, "On"],
        ]
      : c.values!.map((v) => [v, v])
  return (
    // On a wide screen the label sits beside its control, a row shorter each
    <div className="flex min-w-0 flex-col gap-1.5 md:grid md:grid-cols-[112px_minmax(0,1fr)] md:items-center md:gap-3">
      <Label id={id}>{c.label}</Label>
      <Segmented
        aria-labelledby={id}
        value={String(options.findIndex(([v]) => v === value))}
        // Picking the current value again keeps it
        onChange={(i) => i && choose(options[Number(i)]![0])}
        // Dimmed when no state has this value next to the others; it still jumps to the closest one
        items={options.map(([v, l], i) => ({
          value: String(i),
          label: l,
          dim: !reachable(v),
        }))}
        className="flex w-full flex-wrap"
        itemClassName="flex-[1_0_auto] px-2.5"
      />
    </div>
  )
}
