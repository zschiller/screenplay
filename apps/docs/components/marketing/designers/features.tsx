type Feature = {
  title: string
  body: string
  icon: React.ReactNode
}

const features: Feature[] = [
  {
    title: "A canvas around real code",
    body: "Lay out your routes, components, and variants on an infinite canvas. Each artboard is the actual running UI — same auth, same data, same animations.",
    icon: <CanvasIcon />,
  },
  {
    title: "Knobs for design tweaks",
    body: "Expose copy, colors, spacing, and toggles as live controls. Reviewers tweak the design without touching the code — and you see exactly what they tried.",
    icon: <KnobsIcon />,
  },
  {
    title: "State sync across viewers",
    body: "When you scrub a prototype to its loading state, every viewer sees it too. Multiplayer demos with no \"can you go back to the empty state?\"",
    icon: <SyncIcon />,
  },
  {
    title: "Comments anchored to UI",
    body: "Drop a thread on the actual button — not a flattened screenshot. The pin sticks to the DOM node as the design evolves.",
    icon: <CommentIcon />,
  },
]

export function DesignerFeatures() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <span className="font-mono text-xs uppercase tracking-wider text-[#106BE3]">
            Built for designers
          </span>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            The collaboration layer your code prototype was missing.
          </h2>
          <p className="mt-4 text-balance text-muted-foreground">
            You ship in code already — Cursor, Claude, your IDE, whatever.
            Screenplay wraps that work in a canvas so the rest of your team can
            see it, click it, and weigh in.
          </p>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="flex flex-col gap-3 bg-card p-6 transition-colors hover:bg-accent/30"
            >
              <div className="flex size-9 items-center justify-center rounded-md bg-[#106BE3]/10 text-[#106BE3]">
                {f.icon}
              </div>
              <h3 className="text-base font-semibold tracking-tight">
                {f.title}
              </h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function CanvasIcon() {
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
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function KnobsIcon() {
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
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="6" r="2" fill="currentColor" />
      <circle cx="15" cy="12" r="2" fill="currentColor" />
      <circle cx="7" cy="18" r="2" fill="currentColor" />
    </svg>
  )
}

function SyncIcon() {
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
      <path d="M21 12a9 9 0 1 1-3.5-7.1" />
      <polyline points="21 4 21 9 16 9" />
    </svg>
  )
}

function CommentIcon() {
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
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}
