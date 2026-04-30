type Feature = {
  title: string
  body: string
  icon: React.ReactNode
}

const features: Feature[] = [
  {
    title: "Live sandboxes",
    body: "Each artboard boots its own VM. Real code runs, not mockups — install deps, hit APIs, see the actual UI.",
    icon: <SandboxIcon />,
  },
  {
    title: "Realtime collaboration",
    body: "Yjs-backed canvas with cursors, selections, and threaded comments anchored to DOM nodes.",
    icon: <CollabIcon />,
  },
  {
    title: "Claude in the loop",
    body: "An AI coding agent works inside the sandbox. Drop a prompt, review the diff, ship the change.",
    icon: <AgentIcon />,
  },
  {
    title: "Pluggable everything",
    body: "Swap the sandbox provider, Yjs host, Postgres driver, or blob store with a one-line import change.",
    icon: <PluggableIcon />,
  },
]

export function Features() {
  return (
    <section className="border-b border-border/60">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <span className="font-mono text-xs uppercase tracking-wider text-[#106BE3]">
            Why Screenplay
          </span>
          <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Design and code, on the same surface.
          </h2>
          <p className="mt-4 text-balance text-muted-foreground">
            The gap between Figma and your dev environment goes away when every
            artboard is the running product.
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

function SandboxIcon() {
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
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18" />
      <path d="M9 21V9" />
    </svg>
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

function AgentIcon() {
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
      <path d="M12 3v3" />
      <rect x="5" y="6" width="14" height="13" rx="3" />
      <path d="M2 12h3" />
      <path d="M19 12h3" />
      <circle cx="9.5" cy="13" r="1" fill="currentColor" />
      <circle cx="14.5" cy="13" r="1" fill="currentColor" />
    </svg>
  )
}

function PluggableIcon() {
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
      <path d="M9 2v4" />
      <path d="M15 2v4" />
      <rect x="6" y="6" width="12" height="9" rx="2" />
      <path d="M12 15v3a3 3 0 0 0 3 3" />
    </svg>
  )
}
