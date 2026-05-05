import { SyncedReview } from "./synced-review"

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
              Every viewer sees the same state at the same time.
            </h2>
            <p className="mt-4 max-w-xl text-muted-foreground">
              Design reviews often fall back to screen recordings because
              walking someone through a flow over a screen share is
              awkward. In Screenplay, when you click into the loading state,
              every viewer follows. When a reviewer tries the empty state,
              you see it too. Selected items, form values, the current
              step, the route, and modal open/closed are all kept in sync.
            </p>

            <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
              <Bullet>
                <span className="text-foreground">
                  Anything stateful can be shared.
                </span>{" "}
                Forms, toggles, selections, route params, the active tab —
                ask the agent to share a value and it becomes multiplayer.
              </Bullet>
              <Bullet>
                <span className="text-foreground">Conflict-free.</span>{" "}
                Two reviewers editing at once converge cleanly, backed by
                Yjs. No flicker and no last-write-wins surprises.
              </Bullet>
              <Bullet>
                <span className="text-foreground">Persists per artboard.</span>{" "}
                Close the tab and come back later — the prototype is
                exactly where you left it, which is useful for async
                review.
              </Bullet>
              <Bullet>
                <span className="text-foreground">
                  Works with existing state.
                </span>{" "}
                Zustand, Jotai, Redux, or plain hooks — any value can be
                shared.
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
