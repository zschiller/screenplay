import { SectionHeading } from "./section-heading"

const faqs = [
  {
    q: "What is Screenplay, exactly?",
    a: "A canvas for coding agents. Every workspace is a git branch with its own sandbox and dev server, rendered as a live frame. Your agents write code in those workspaces, and you compare the results side by side instead of one checkout at a time.",
  },
  {
    q: "Which agents does it work with?",
    a: "Claude Code, Codex and opencode, using your existing CLIs and accounts, plus a built-in agent on the Vercel AI SDK that talks to Anthropic, OpenAI, Google, the Vercel AI Gateway or any OpenAI-compatible endpoint.",
  },
  {
    q: "Does my code leave my machine?",
    a: "Not with the desktop app. It runs fully offline: sandboxes are git worktrees on your disk, data lives in a local database, and agents are the CLIs you've installed.",
  },
  {
    q: "How does the multiplayer part work?",
    a: "Deploy the web app (Vercel, Postgres and GitHub OAuth) and each workspace runs in a hosted sandbox VM. Share a canvas and everyone sees the same frames, cursors, comments and agent streams in real time.",
  },
  {
    q: "Do I need to change my app?",
    a: "No. Anything with a dev server works. If you want knobs or synced state across frames, drop in the two small npm packages — they no-op in production builds.",
  },
  {
    q: "What does it cost?",
    a: "Nothing. Screenplay is MIT licensed. You bring your own agent subscriptions or API keys.",
  },
]

export function Faq() {
  return (
    <section className="mx-auto grid w-full max-w-6xl gap-12 px-5 py-24 sm:px-8 sm:py-32 lg:grid-cols-[0.8fr_1.2fr]">
      <SectionHeading slug="Q & A" title="Questions from the audience." />
      <div className="divide-y divide-border border-y border-border">
        {faqs.map((f) => (
          <details
            key={f.q}
            className="faq-item group py-5 [&_summary::-webkit-details-marker]:hidden"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-base font-medium">
              {f.q}
              {/* Two bars rather than a "+" glyph, so the cross sits dead-centre
                  and can spin into an × when the answer opens. */}
              <span
                aria-hidden
                className="relative size-7 shrink-0 rounded-full border border-border text-muted-foreground transition-[transform,background-color,color,border-color] duration-300 ease-[cubic-bezier(.3,1.5,.5,1)] group-open:rotate-[135deg] group-open:border-foreground group-open:bg-foreground group-open:text-background group-[:not([open])]:group-hover:text-foreground"
              >
                <span className="absolute top-1/2 left-1/2 h-[1.5px] w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
                <span className="absolute top-1/2 left-1/2 h-3 w-[1.5px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
              </span>
            </summary>
            <p className="mt-3 pr-10 text-sm leading-relaxed text-muted-foreground">
              {f.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  )
}
