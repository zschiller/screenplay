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
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      {/* Fake browser chrome */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5">
        <span className="size-2.5 rounded-full bg-muted-foreground/20" />
        <span className="size-2.5 rounded-full bg-muted-foreground/20" />
        <span className="size-2.5 rounded-full bg-muted-foreground/20" />
        <div className="mx-auto flex items-center gap-1.5 rounded-md bg-background/70 px-3 py-1 text-[10px] text-muted-foreground/60">
          <span>acme-store.com</span>
          <span className="text-muted-foreground/30">/checkout</span>
        </div>
        {/* Presence avatars */}
        <div className="flex items-center">
          <div className="flex -space-x-1.5">
            {[
              { initials: "M", color: "#106BE3" },
              { initials: "J", color: "#E0457B" },
              { initials: "S", color: "#10B981" },
            ].map(({ initials, color }) => (
              <span
                key={initials}
                className="flex size-5 items-center justify-center rounded-full text-[9px] font-semibold text-white ring-2 ring-card"
                style={{ backgroundColor: color }}
              >
                {initials}
              </span>
            ))}
          </div>
          <span className="ml-2 flex items-center gap-1">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#106BE3] opacity-75" />
              <span className="relative inline-flex size-1.5 rounded-full bg-[#106BE3]" />
            </span>
            <span className="font-mono text-[9px] text-muted-foreground">synced</span>
          </span>
        </div>
      </div>

      {/* Checkout UI */}
      <div className="p-5">
        {/* Step progress */}
        <div className="mb-5 flex items-center gap-2">
          {["Cart", "Shipping", "Payment", "Confirm"].map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span
                  className={`flex size-4 items-center justify-center rounded-full text-[9px] font-semibold ${
                    i < 2
                      ? "bg-[#106BE3] text-white"
                      : i === 2
                        ? "border-2 border-[#106BE3] text-[#106BE3]"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i < 2 ? "✓" : i + 1}
                </span>
                <span
                  className={`text-[10px] font-medium ${i <= 2 ? "text-foreground" : "text-muted-foreground"}`}
                >
                  {step}
                </span>
              </div>
              {i < 3 && (
                <div
                  className={`h-px w-6 ${i < 2 ? "bg-[#106BE3]" : "bg-border"}`}
                />
              )}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_auto] gap-4">
          {/* Left: form */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-foreground">Payment details</p>
            {/* Card number */}
            <div className="space-y-1">
              <label className="text-[10px] text-muted-foreground">Card number</label>
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
                <span className="text-[11px] tracking-widest text-foreground/80">
                  •••• •••• •••• 4242
                </span>
                <span className="ml-auto rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
                  VISA
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">Expiry</label>
                <div className="rounded-md border border-border bg-background px-3 py-2 text-[11px] text-foreground/80">
                  08 / 26
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground">CVC</label>
                <div className="flex items-center gap-1.5 rounded-md border border-[#106BE3] bg-background px-3 py-2 ring-1 ring-[#106BE3]/30">
                  <span className="text-[11px] text-foreground/80">•••</span>
                  <span className="ml-auto h-3 w-px animate-pulse bg-[#106BE3]" />
                </div>
              </div>
            </div>
            <button className="w-full rounded-md bg-[#106BE3] py-2 text-[11px] font-semibold text-white shadow-sm">
              Pay $128.00
            </button>
          </div>

          {/* Right: order summary */}
          <div className="w-36 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-[10px] font-semibold text-foreground">Order summary</p>
            {[
              { name: "Merino tee", qty: 1, price: "$68" },
              { name: "Canvas tote", qty: 2, price: "$44" },
            ].map((item) => (
              <div key={item.name} className="flex items-start justify-between gap-1">
                <div>
                  <p className="text-[10px] text-foreground/80">{item.name}</p>
                  <p className="text-[9px] text-muted-foreground">qty {item.qty}</p>
                </div>
                <span className="text-[10px] font-medium text-foreground">{item.price}</span>
              </div>
            ))}
            <div className="border-t border-border pt-2">
              <div className="flex justify-between">
                <span className="text-[10px] text-muted-foreground">Shipping</span>
                <span className="text-[10px] text-muted-foreground">Free</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-[10px] font-semibold text-foreground">Total</span>
                <span className="text-[10px] font-semibold text-foreground">$128.00</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
