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
              Review every state with the room in lock-step.
            </h2>
            <p className="mt-4 max-w-xl text-muted-foreground">
              The reason design reviews fall back to Loom: walking someone
              through a flow over a screen share. With Screenplay, when you
              click into the loading state, every viewer follows. When your
              reviewer tries the empty state, you see it. Selected items,
              form values, current step, route, modal open/closed — same
              screen, same time, no narration required.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
              <Bullet>
                <span className="text-foreground">
                  Anything stateful, shared.
                </span>{" "}
                Forms, toggles, selections, route params, the active tab —
                ask the agent to make a piece of state shared and it&apos;s
                multiplayer.
              </Bullet>
              <Bullet>
                <span className="text-foreground">Conflict-free.</span>{" "}
                Two reviewers tweaking at once converge cleanly, backed by
                Yjs. No flicker, no last-write-wins surprises.
              </Bullet>
              <Bullet>
                <span className="text-foreground">Persists per artboard.</span>{" "}
                Close the tab, come back tomorrow, the prototype is exactly
                where you left it — handy for async review.
              </Bullet>
              <Bullet>
                <span className="text-foreground">
                  Works with what the agent already wrote.
                </span>{" "}
                Zustand, Jotai, Redux, plain hooks — if it&apos;s a value, it
                can be shared.
              </Bullet>
            </ul>
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

function SyncedReview() {
  return (
    <div className="space-y-2">
      <ClientWindow
        user={{ initials: "M", name: "maya · designer", color: "#106BE3" }}
        activeStep={2}
        showCursor
      />

      {/* Sync connector */}
      <div className="flex items-center gap-3 px-2">
        <div className="h-px flex-1 bg-border" />
        <div className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1 shadow-sm">
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#106BE3] opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-[#106BE3]" />
          </span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
            state synced
          </span>
        </div>
        <div className="h-px flex-1 bg-border" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ClientWindow
          user={{ initials: "J", name: "jules · pm", color: "#E0457B" }}
          activeStep={2}
        />
        <ClientWindow
          user={{ initials: "S", name: "sam · eng", color: "#10B981" }}
          activeStep={2}
        />
      </div>
    </div>
  )
}

function ClientWindow({
  user,
  activeStep,
  showCursor,
}: {
  user: { initials: string; name: string; color: string }
  activeStep: number
  showCursor?: boolean
}) {
  const steps = ["Cart", "Ship", "Pay", "Done"]

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* Browser chrome */}
      <div className="flex items-center gap-1.5 border-b border-border bg-muted/50 px-3 py-2">
        <span className="size-2 rounded-full bg-muted-foreground/20" />
        <span className="size-2 rounded-full bg-muted-foreground/20" />
        <span className="size-2 rounded-full bg-muted-foreground/20" />
        <div className="mx-2 flex-1 rounded bg-background/60 px-2 py-0.5 text-[9px] text-muted-foreground/50">
          acme.com/checkout
        </div>
        <span
          className="flex size-4 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white"
          style={{ backgroundColor: user.color }}
        >
          {user.initials}
        </span>
        <span className="text-[9px] text-muted-foreground">{user.name}</span>
      </div>

      {/* Checkout content */}
      <div className="p-3">
        {/* Step progress */}
        <div className="mb-3 flex items-center justify-between">
          {steps.map((step, i) => (
            <div key={step} className="flex items-center gap-1">
              <div className="flex items-center gap-1">
                <span
                  className={`flex size-3.5 items-center justify-center rounded-full text-[8px] font-semibold ${
                    i < activeStep
                      ? "bg-[#106BE3] text-white"
                      : i === activeStep
                        ? "border border-[#106BE3] text-[#106BE3]"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i < activeStep ? "✓" : i + 1}
                </span>
                <span
                  className={`text-[9px] ${i <= activeStep ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {step}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div className={`h-px w-3 ${i < activeStep ? "bg-[#106BE3]" : "bg-border"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Payment form */}
        <div className="space-y-2">
          <div className="space-y-1">
            <p className="text-[9px] text-muted-foreground">Card number</p>
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
              <span className="text-[10px] tracking-widest text-foreground/70">•••• 4242</span>
              <span className="ml-auto rounded bg-muted px-1 text-[8px] text-muted-foreground">VISA</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <div className="space-y-1">
              <p className="text-[9px] text-muted-foreground">Expiry</p>
              <div className="rounded-md border border-border bg-background px-2 py-1.5 text-[10px] text-foreground/70">
                08 / 26
              </div>
            </div>
            <div className="space-y-1">
              <p className="text-[9px] text-muted-foreground">CVC</p>
              <div
                className={`flex items-center gap-1 rounded-md border bg-background px-2 py-1.5 ${
                  showCursor
                    ? "border-[#106BE3] ring-1 ring-[#106BE3]/30"
                    : "border-border"
                }`}
              >
                <span className="text-[10px] text-foreground/70">•••</span>
                {showCursor && (
                  <span className="ml-auto h-2.5 w-px animate-pulse bg-[#106BE3]" />
                )}
              </div>
            </div>
          </div>
          <button className="w-full rounded-md bg-[#106BE3] py-1.5 text-[10px] font-semibold text-white">
            Pay $128.00
          </button>
        </div>
      </div>
    </div>
  )
}
