import { CodeBlock, tok } from "./code-block"
import { KnobsMockup } from "./knobs-mockup"
import { StateMockup } from "./state-mockup"
import { knobsNpmUrl, stateNpmUrl } from "@/lib/app-url"

export function Packages() {
  return (
    <section className="border-b border-border/60 bg-muted/30">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <span className="font-mono text-xs uppercase tracking-wider text-[#106BE3]">
            Open packages
          </span>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Two tiny packages. Powerful prototypes.
          </h2>
          <p className="mt-4 text-balance text-muted-foreground">
            Drop them into any React app to expose live controls and shared
            state to the canvas. Both are{" "}
            <span className="rounded bg-foreground/10 px-1 py-0.5 font-mono text-xs">
              dev-only
            </span>{" "}
            by design — every API is a no-op in production builds, so it&apos;s
            safe to ship the calls in committed code.
          </p>
        </div>

        <div className="mt-12 space-y-10">
          <PackageRow
            name="@screenplay.space/knobs"
            href={knobsNpmUrl}
            tagline="Declarative interactive controls"
            body="Declare sliders, switches, color pickers, and selects from a prototype's own code. They show up next to the artboard on the canvas, and values sync across every viewer in the room in real time."
            mockup={<KnobsMockup />}
            code={<KnobsCode />}
            reverse={false}
          />
          <PackageRow
            name="@screenplay.space/state"
            href={stateNpmUrl}
            tagline="Mirror UI state to the canvas"
            body="Bridge prototype state to the parent canvas with one hook. Yjs persists it per artboard and pushes changes back into every viewer's iframe — bump a counter in one client, every other client follows."
            mockup={<StateMockup />}
            code={<StateCode />}
            reverse
          />
        </div>
      </div>
    </section>
  )
}

function PackageRow({
  name,
  href,
  tagline,
  body,
  mockup,
  code,
  reverse,
}: {
  name: string
  href: string
  tagline: string
  body: string
  mockup: React.ReactNode
  code: React.ReactNode
  reverse?: boolean
}) {
  return (
    <div
      className={`grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:items-stretch ${
        reverse ? "lg:[&>*:first-child]:order-2" : ""
      }`}
    >
      <div className="flex flex-col gap-5">
        <div>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-sm font-medium text-[#106BE3] hover:underline"
          >
            {name}
          </a>
          <h3 className="mt-2 text-2xl font-semibold tracking-tight">
            {tagline}
          </h3>
          <p className="mt-3 text-muted-foreground">{body}</p>
        </div>
        {code}
      </div>
      <div className="min-h-[320px]">{mockup}</div>
    </div>
  )
}

function KnobsCode() {
  return (
    <CodeBlock filename="card.tsx">
      <span className={tok.keyword}>import</span> {"{ "}
      <span className={tok.fn}>useKnob</span>
      {" } "}
      <span className={tok.keyword}>from</span>{" "}
      <span className={tok.string}>{`"@screenplay.space/knobs"`}</span>
      {"\n\n"}
      <span className={tok.keyword}>export function</span>{" "}
      <span className={tok.fn}>Card</span>
      <span className={tok.punct}>{"() {"}</span>
      {"\n  "}
      <span className={tok.keyword}>const</span> padding ={" "}
      <span className={tok.fn}>useKnob</span>
      <span className={tok.punct}>{"({"}</span>
      {"\n    "}
      <span className={tok.prop}>id</span>:{" "}
      <span className={tok.string}>{`"card-padding"`}</span>,{"\n    "}
      <span className={tok.prop}>type</span>:{" "}
      <span className={tok.string}>{`"slider"`}</span>,{"\n    "}
      <span className={tok.prop}>min</span>:{" "}
      <span className={tok.number}>0</span>,{" "}
      <span className={tok.prop}>max</span>:{" "}
      <span className={tok.number}>64</span>,{"\n    "}
      <span className={tok.prop}>default</span>:{" "}
      <span className={tok.number}>16</span>,{"\n  "}
      <span className={tok.punct}>{"})"}</span>
      {"\n\n  "}
      <span className={tok.keyword}>return</span>{" "}
      <span className={tok.punct}>{"<div style={{ padding }}>…</div>"}</span>
      {"\n"}
      <span className={tok.punct}>{"}"}</span>
    </CodeBlock>
  )
}

function StateCode() {
  return (
    <CodeBlock filename="counter.tsx">
      <span className={tok.keyword}>import</span> {"{ "}
      <span className={tok.fn}>useSharedState</span>
      {" } "}
      <span className={tok.keyword}>from</span>{" "}
      <span className={tok.string}>{`"@screenplay.space/state"`}</span>
      {"\n\n"}
      <span className={tok.keyword}>function</span>{" "}
      <span className={tok.fn}>Counter</span>
      <span className={tok.punct}>{"() {"}</span>
      {"\n  "}
      <span className={tok.keyword}>const</span> [count, setCount] ={" "}
      <span className={tok.fn}>useState</span>
      <span className={tok.punct}>(</span>
      <span className={tok.number}>0</span>
      <span className={tok.punct}>)</span>
      {"\n  "}
      <span className={tok.fn}>useSharedState</span>
      <span className={tok.punct}>(</span>
      <span className={tok.string}>{`"count"`}</span>, count, setCount
      <span className={tok.punct}>)</span>
      {"\n\n  "}
      <span className={tok.comment}>{`// every viewer's count stays in sync`}</span>
      {"\n  "}
      <span className={tok.keyword}>return</span>{" "}
      <span className={tok.punct}>{"<button onClick={"}</span>
      {"() => "}
      <span className={tok.fn}>setCount</span>
      <span className={tok.punct}>{"(c => c + 1)"}</span>
      <span className={tok.punct}>{"}>"}</span>
      {"{count}"}
      <span className={tok.punct}>{"</button>"}</span>
      {"\n"}
      <span className={tok.punct}>{"}"}</span>
    </CodeBlock>
  )
}
