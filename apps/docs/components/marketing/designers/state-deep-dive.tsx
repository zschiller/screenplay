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
