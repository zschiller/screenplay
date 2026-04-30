type Loss = {
  eyebrow: string
  pain: string
  fix: string
  icon: React.ReactNode
}

const losses: Loss[] = [
  {
    eyebrow: "Collaboration",
    pain: "Localhost is for one. So is your agent chat.",
    fix: "Two designers vibe coding can't see each other's screen, can't read each other's agent transcript, can't comment on a state without checking out the same branch. Screenplay drops your prototype into a shared room — same artboards, same sandbox, same agent in the loop, cursors and comments and knobs in real time.",
    icon: <CollabIcon />,
  },
  {
    eyebrow: "Going broad",
    pain: "Agents go deep. Branches don't compare.",
    fix: "AI agents are great at sprinting one direction at a time. Going broad means juggling branches — which don't sit next to each other, don't run side by side, and don't take a comment. Each artboard on the canvas is its own branch in its own sandbox. Three takes on a screen, three artboards, one glance.",
    icon: <BreadthIcon />,
  },
  {
    eyebrow: "Communication",
    pain: "Loom isn't a design review.",
    fix: "Talking through a flow without Figma means screenshots, screen recordings, or \"can you click that again?\". Screenplay lays every screen and every state out on an infinite canvas. Comments anchor to the actual button. Scrub through states and every viewer follows.",
    icon: <CommIcon />,
  },
]

export function DesignerFeatures() {
  return (
    <section
      id="what-you-lost"
      className="border-b border-border/60 scroll-mt-16"
    >
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <span className="font-mono text-xs uppercase tracking-wider text-[#106BE3]">
            What you lost when you stopped opening Figma
          </span>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Real code is awesome. The design loop got worse.
          </h2>
          <p className="mt-4 text-balance text-muted-foreground">
            Screenplay is built around the three things vibe coding broke —
            and puts them back without asking you to give up real code.
          </p>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-3">
          {losses.map((loss) => (
            <div
              key={loss.eyebrow}
              className="flex flex-col gap-4 bg-card p-7 transition-colors hover:bg-accent/30"
            >
              <div className="flex size-9 items-center justify-center rounded-md bg-[#106BE3]/10 text-[#106BE3]">
                {loss.icon}
              </div>
              <div>
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {loss.eyebrow}
                </span>
                <h3 className="mt-1 text-lg font-semibold tracking-tight">
                  {loss.pain}
                </h3>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {loss.fix}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function CollabIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="9" cy="9" r="3" />
      <circle cx="17" cy="13" r="2.5" />
      <path d="M3 21c.7-3 3.1-5 6-5s5.3 2 6 5" />
      <path d="M14.5 19c.5-1.7 2-3 4-3s3.5 1.3 4 3" />
    </svg>
  )
}

function BreadthIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {/* Three forking branches */}
      <circle cx="6" cy="5" r="1.6" />
      <path d="M6 6.6 V11" />
      <path d="M6 11 H12" />
      <path d="M12 11 V7" />
      <circle cx="12" cy="5.4" r="1.6" />
      <path d="M6 11 V17" />
      <circle cx="6" cy="18.6" r="1.6" />
      <path d="M6 11 H18" />
      <path d="M18 11 V17" />
      <circle cx="18" cy="18.6" r="1.6" />
    </svg>
  )
}

function CommIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="8" height="6" rx="1" />
      <rect x="13" y="4" width="8" height="6" rx="1" />
      <rect x="3" y="14" width="8" height="6" rx="1" />
      <rect x="13" y="14" width="8" height="6" rx="1" />
    </svg>
  )
}
