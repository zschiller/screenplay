import { cn } from "@workspace/ui/lib/utils"

import { focusRing, measure, sectionTop } from "./editorial"
import { SectionHeading } from "./section-heading"

const faqs = [
  {
    q: "What is Screenplay, exactly?",
    a: "A canvas for coding agents. Every Workspace is a git branch with its own sandbox and dev server, rendered as a live frame. Your agents write code in those Workspaces, and you compare the results side by side instead of one checkout at a time.",
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
    a: "Deploy the web app (Vercel, Postgres and GitHub OAuth) and each Workspace runs in a hosted sandbox VM. Share a canvas and everyone sees the same frames, cursors, comments and agent streams in real time.",
  },
  {
    q: "Do I need to change my app?",
    a: "No. Anything with a dev server works. If you want knobs or synced state across frames, drop in the two small npm packages. They no-op in production builds.",
  },
  {
    q: "What does it cost?",
    a: "Nothing. Screenplay is MIT licensed. You bring your own agent subscriptions or API keys.",
  },
]

export function Faq() {
  return (
    <section className={cn(measure, sectionTop)}>
      <SectionHeading
        slug="FAQ"
        title="Before you download."
        tier="reference"
      />
      <div className="mt-12 border-t border-foreground">
        {faqs.map((f) => (
          <details
            key={f.q}
            className="faq-item group border-b border-border py-5 [&_summary::-webkit-details-marker]:hidden"
          >
            <summary
              className={cn(
                focusRing,
                "flex cursor-pointer list-none items-baseline justify-between gap-4 font-heading text-[20px] leading-[1.25] tracking-[-0.03em] focus-visible:outline-offset-4"
              )}
            >
              {f.q}
              <span
                aria-hidden
                className="font-mono text-[22px] text-muted-foreground after:content-['+'] group-open:after:content-['–']"
              />
            </summary>
            <p className="mt-3 max-w-[68ch] leading-relaxed text-muted-foreground">
              {f.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  )
}
