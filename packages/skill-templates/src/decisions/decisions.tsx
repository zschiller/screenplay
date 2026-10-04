// The design-audit decisions page: one form column. Summary and copy bar
// first, then questions grouped by surface, then the PRs that run regardless
// and a preview of the copied text.

import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import { Input } from "@workspace/ui/components/input"
import { Label as FieldLabel } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

import { Label, load, store } from "../shared/page.tsx"
import { Lightbox, Shots, type Img } from "../shared/shots.tsx"
import { ThemeContext, useTheme } from "../shared/theme.tsx"

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
  const [dark] = useTheme()
  const KEY = "decisions-" + page.slug
  const all = surfaces.flatMap((s) => s.qs)
  const [answers, setAnswers] = React.useState<Record<string, Answer>>(() => {
    const saved = load<Record<string, Answer>>(KEY)
    return Object.fromEntries(
      all.map((q) => [q.id, { ...EMPTY, ...saved[q.id] }])
    )
  })
  React.useEffect(() => store(KEY, answers), [KEY, answers])
  const [status, setStatus] = React.useState("")
  const preview = React.useRef<HTMLPreElement>(null)
  const set = (id: string, a: Partial<Answer>) =>
    setAnswers((s) => ({ ...s, [id]: { ...s[id]!, ...a } }))

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
  const text = (() => {
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
    return lines.join("\n").trim()
  })()
  const isAnswered = (s: Answer) => !!s.v && !(s.v === "own" && !s.own.trim())
  const n = all.filter((q) => isAnswered(answers[q.id]!)).length

  const copy = () => {
    const fallback = () => {
      const p = preview.current!
      const r = document.createRange()
      r.selectNodeContents(p)
      const sel = getSelection()!
      sel.removeAllRanges()
      sel.addRange(r)
      p.scrollIntoView({ block: "center" })
      setStatus(
        "Copy was blocked. The text below is selected; copy it by hand."
      )
    }
    try {
      navigator.clipboard
        .writeText(text)
        .then(
          () => setStatus("Copied. Paste it in the project chat."),
          fallback
        )
    } catch {
      fallback()
    }
  }

  return (
    <ThemeContext.Provider value={dark}>
      <Lightbox>
        <div className="mx-auto flex max-w-[860px] flex-col gap-12 px-5 pt-10 pb-30">
          <header>
            <Label accent>
              {page.label} · {page.date}
            </Label>
            <h1 className="mt-2.5 mb-3.5 font-heading text-title-xl text-balance">
              {page.title}
            </h1>
            <p className="max-w-[64ch] text-sm text-muted-foreground">
              {all.length} {all.length === 1 ? "question" : "questions"} from
              the {page.plans}. Pick an option, pick{" "}
              <b className="font-medium text-foreground">None of these</b>, or
              write your own, and add a note if you like. Anything you leave
              blank keeps my recommendation. When you’re done, press{" "}
              <b className="font-medium text-foreground">Copy decisions</b> and
              paste the text back in the project chat.
            </p>
            <div className="mt-4 flex flex-wrap gap-x-4.5 gap-y-1.5 font-mono text-xs font-medium tracking-wider uppercase">
              {page.links.map(([t, u]) => (
                <a
                  key={u}
                  href={u}
                  className="text-foreground underline decoration-border"
                >
                  {t}
                </a>
              ))}
              <a
                href="#runs"
                className="text-foreground underline decoration-border"
              >
                PRs that need no decision
              </a>
            </div>
          </header>

          <div className="sticky top-[env(safe-area-inset-top,0px)] z-[5] -my-6 flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b bg-background py-3">
            <span className="mr-auto font-mono text-sm text-muted-foreground tabular-nums">
              <b className="font-medium text-foreground">{n}</b> of {all.length}{" "}
              answered
            </span>
            <nav aria-label="Surfaces" className="flex gap-3.5 text-sm">
              {surfaces.map((s) => (
                <a
                  key={s.key}
                  href={`#${s.key}`}
                  className="text-muted-foreground no-underline hover:text-foreground"
                >
                  {s.name}
                </a>
              ))}
            </nav>
            <Button type="button" onClick={copy}>
              Copy decisions
            </Button>
            <span
              role="status"
              aria-live="polite"
              className="text-sm text-success"
            >
              {status}
            </span>
          </div>

          <form
            onSubmit={(e) => e.preventDefault()}
            className="flex flex-col gap-12"
          >
            {surfaces.map((s) => (
              <section
                key={s.key}
                id={s.key}
                className="flex scroll-mt-18 flex-col"
              >
                <div className="flex flex-col gap-1.5 border-b border-foreground pb-4">
                  <Label>
                    {s.qs.length} {s.qs.length === 1 ? "question" : "questions"}{" "}
                    ·{" "}
                    <a href={s.plan} className="text-info">
                      open the plan
                    </a>
                  </Label>
                  <h2 className="m-0 font-heading text-title-md text-balance">
                    {s.name}
                  </h2>
                  <p className="text-sm text-muted-foreground">{s.intro}</p>
                </div>
                {s.qs.map((q) => (
                  <Question
                    key={q.id}
                    q={q}
                    a={answers[q.id]!}
                    answered={isAnswered(answers[q.id]!)}
                    set={(a) => set(q.id, a)}
                  />
                ))}
              </section>
            ))}
          </form>

          <section id="runs" className="flex flex-col gap-4.5">
            <Head label="Runs regardless" title="PRs that need no decision">
              These go ahead once you hand the decisions back. A PR marked with
              a question id waits on that answer.
            </Head>
            {surfaces.map((s) => (
              <div key={s.key} className="flex flex-col gap-1.5">
                <Label>{s.name}</Label>
                <ul className="m-0 list-none border-t p-0">
                  {(runs[s.key] ?? []).map(([num, title, w]) => (
                    <li
                      key={num}
                      className="grid grid-cols-[28px_minmax(0,1fr)] items-baseline gap-x-3 border-b py-2 text-sm sm:grid-cols-[36px_minmax(0,1fr)_auto]"
                    >
                      <span className="font-heading text-info tabular-nums">
                        {num}
                      </span>
                      <span>{title}</span>
                      <span
                        className={cn(
                          "col-start-2 font-mono text-xs font-medium sm:col-start-auto sm:text-right",
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

          <section className="flex flex-col gap-4.5">
            <Head label="Preview" title="What Copy decisions gives you" />
            <pre
              ref={preview}
              className="m-0 max-h-80 overflow-auto rounded-lg border bg-muted p-3 font-mono text-xs whitespace-pre-wrap"
            >
              {text}
            </pre>
          </section>
        </div>
      </Lightbox>
    </ThemeContext.Provider>
  )
}

function Head({
  label,
  title,
  children,
}: {
  label: string
  title: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-foreground pb-4">
      <Label>{label}</Label>
      <h2 className="m-0 font-heading text-title-md text-balance">{title}</h2>
      {children && <p className="text-sm text-muted-foreground">{children}</p>}
    </div>
  )
}

function Question({
  q,
  a,
  answered,
  set,
}: {
  q: Q
  a: Answer
  answered: boolean
  set: (a: Partial<Answer>) => void
}) {
  const own = React.useRef<HTMLInputElement>(null)
  const choices: [string, string, string | null, "opt" | "alt"][] = [
    ...q.o.map(([l, d], i): [string, string, string | null, "opt" | "alt"] => [
      `o${i}`,
      l,
      d,
      "opt",
    ]),
    ["none", "None of these", null, "alt"],
    ["own", "Write my own", null, "alt"],
  ]
  return (
    <div id={`q-${q.id}`} className="flex flex-col gap-3 border-b py-6">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-2.5 font-mono text-xs font-medium">
          <span className="text-info">{q.id}</span>
          <span className="tracking-wide text-muted-foreground">{q.where}</span>
          {answered && <span className="text-success">Answered</span>}
        </div>
        <h3 className="m-0 font-heading text-title-sm text-balance">{q.t}</h3>
      </header>
      <p className="max-w-[68ch] text-sm text-muted-foreground">{q.c}</p>
      <Shots
        list={q.img}
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-2.5"
      />
      <fieldset className="m-0 flex min-w-0 flex-col gap-0.5 border-0 p-0">
        <legend className="sr-only">{q.t}</legend>
        {choices.map(([v, l, d, kind]) => (
          <label
            key={v}
            className="grid cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-start gap-2 rounded-lg px-2.5 py-2 text-sm hover:bg-muted has-checked:bg-muted has-checked:ring-1 has-checked:ring-border"
          >
            <input
              type="radio"
              name={q.id}
              value={v}
              checked={a.v === v}
              onChange={() => {
                set({ v })
                if (v === "own")
                  requestAnimationFrame(() => own.current?.focus())
              }}
              className="mt-0.5 accent-foreground"
            />
            <span>
              <span
                className={cn(
                  kind === "opt" ? "font-medium" : "text-muted-foreground",
                  kind === "alt" && a.v === v && "text-foreground"
                )}
              >
                {l}
              </span>
              {v === "o0" && (
                <span className="ml-1.5 font-mono text-xs font-medium tracking-wider text-info uppercase">
                  Recommended
                </span>
              )}
              {d && <span className="block text-muted-foreground">{d}</span>}
            </span>
          </label>
        ))}
        <div hidden={a.v !== "own"} className="mt-0.5 mb-1 sm:ml-9.5">
          <Input
            ref={own}
            aria-label={`Your answer for ${q.id}`}
            placeholder="Your answer"
            value={a.own}
            onChange={(e) => set({ own: e.target.value })}
          />
        </div>
      </fieldset>
      <div className="flex flex-col gap-1">
        <FieldLabel
          htmlFor={`${q.id}-note`}
          className="font-normal text-muted-foreground"
        >
          Note (optional)
        </FieldLabel>
        <Textarea
          id={`${q.id}-note`}
          rows={1}
          value={a.note}
          onChange={(e) => set({ note: e.target.value })}
          className="min-h-10 resize-y text-sm md:text-sm"
        />
      </div>
    </div>
  )
}
