import { CodeBlock, tok } from "../code-block"

export function StateDeepDive() {
  return (
    <section id="state-sync" className="border-b border-border/60 scroll-mt-16">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="grid gap-12 lg:grid-cols-[1fr_1.05fr] lg:items-start">
          <div className="lg:order-2">
            <span className="font-mono text-xs uppercase tracking-wider text-[#106BE3]">
              State sync
            </span>
            <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              The whole room sees the same screen.
            </h2>
            <p className="mt-4 max-w-xl text-muted-foreground">
              When you click into the loading state, every viewer follows. When
              your reviewer toggles the empty state, you see it on your end
              too. Stop saying &ldquo;ok now go back to the error
              screen&rdquo;— state sync is one hook.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
              <Bullet>
                <span className="text-foreground">
                  One hook, any state.
                </span>{" "}
                Wrap a <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">useState</code>{" "}
                with <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">useSharedState</code>{" "}
                and it&apos;s multiplayer. Forms, toggles, route params, selected
                items — anything.
              </Bullet>
              <Bullet>
                <span className="text-foreground">
                  Yjs-backed, conflict-free.
                </span>{" "}
                Two reviewers tweaking at once converge cleanly. No flicker, no
                last-write-wins surprises.
              </Bullet>
              <Bullet>
                <span className="text-foreground">
                  Persists per artboard.
                </span>{" "}
                Close the tab, come back tomorrow, the prototype is exactly
                where you left it. Great for long-running review threads.
              </Bullet>
              <Bullet>
                <span className="text-foreground">
                  Works with what you already have.
                </span>{" "}
                Zustand, Jotai, Redux, plain hooks — if it&apos;s a value, it
                can be shared.
              </Bullet>
            </ul>

            <div className="mt-8">
              <StateCode />
            </div>
          </div>

          <div className="lg:order-1">
            <SyncedReview />
          </div>
        </div>
      </div>
    </section>
  )
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[#106BE3]"
      />
      <span className="leading-relaxed">{children}</span>
    </li>
  )
}

function StateCode() {
  return (
    <CodeBlock filename="checkout.tsx">
      <span className={tok.keyword}>import</span> {"{ "}
      <span className={tok.fn}>useSharedState</span>
      {" } "}
      <span className={tok.keyword}>from</span>{" "}
      <span className={tok.string}>{`"@screenplay.space/state"`}</span>
      {"\n\n"}
      <span className={tok.keyword}>function</span>{" "}
      <span className={tok.fn}>Checkout</span>
      <span className={tok.punct}>{"() {"}</span>
      {"\n  "}
      <span className={tok.keyword}>const</span> [step, setStep] ={" "}
      <span className={tok.fn}>useState</span>
      <span className={tok.punct}>(</span>
      <span className={tok.string}>{`"cart"`}</span>
      <span className={tok.punct}>)</span>
      {"\n  "}
      <span className={tok.fn}>useSharedState</span>
      <span className={tok.punct}>(</span>
      <span className={tok.string}>{`"checkout-step"`}</span>, step, setStep
      <span className={tok.punct}>)</span>
      {"\n\n  "}
      <span className={tok.comment}>{`// design reviewer flips the step → you see it instantly`}</span>
      {"\n  "}
      <span className={tok.keyword}>return</span>{" "}
      <span className={tok.punct}>{"<Stepper value={step} onChange={setStep} />"}</span>
      {"\n"}
      <span className={tok.punct}>{"}"}</span>
    </CodeBlock>
  )
}

function SyncedReview() {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
      {/* Sync status header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <span className="inline-flex w-fit items-center rounded-md bg-pink-100 px-1.5 py-0 font-mono text-[10px] text-pink-700 dark:bg-pink-950 dark:text-pink-300">
            design/checkout
          </span>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 ring-1 ring-card" />
            <span className="text-[11px] font-medium text-foreground/70">
              Checkout
            </span>
            <span className="rounded-md bg-muted px-1.5 py-0 font-mono text-[10px] text-foreground/50">
              /checkout
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-full border border-border bg-background px-2 py-1 shadow-sm">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#106BE3] opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-[#106BE3]" />
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            synced · 3
          </span>
        </div>
      </div>

      {/* Stacked synced viewers */}
      <div className="space-y-3">
        <SyncedViewer name="maya · design" color="#106BE3" />
        <SyncedViewer name="jules · pm" color="#E0457B" />
        <SyncedViewer name="sam · eng" color="#10B981" />
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 rounded-md bg-muted/40 py-2 text-[10px] text-muted-foreground">
        <span className="font-mono">useSharedState</span>
        <span>·</span>
        <span>one hook, all viewers in lock-step</span>
      </div>
    </div>
  )
}

function SyncedViewer({ name, color }: { name: string; color: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-3 py-1.5">
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="size-2 rounded-full bg-muted-foreground/30" />
        <span className="ml-1.5 flex items-center gap-1.5">
          <span
            className="inline-block size-1.5 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="font-mono text-[10px] text-muted-foreground">
            {name}
          </span>
        </span>
      </div>
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Stepper */}
        <Stepper />
        {/* Right-side state pill */}
        <div className="ml-auto flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            step
          </span>
          <span className="state-step-label font-mono text-[10px] font-medium text-foreground" />
        </div>
      </div>
    </div>
  )
}

function Stepper() {
  // 4 steps; the active dot's position is animated via the .state-stepper class
  const labels = ["cart", "address", "pay", "done"]
  return (
    <div className="relative flex flex-1 items-center">
      <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      <div className="state-stepper-fill absolute left-0 top-1/2 h-px -translate-y-1/2 bg-[#106BE3]" />
      <div className="relative flex flex-1 items-center justify-between">
        {labels.map((l, i) => (
          <div key={l} className="flex flex-col items-center gap-1">
            <span
              className={`state-stepper-dot state-stepper-dot-${i} block size-2.5 rounded-full border border-border bg-card`}
            />
            <span className="font-mono text-[9px] text-muted-foreground">
              {l}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
