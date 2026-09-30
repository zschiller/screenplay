import { cn } from "@workspace/ui/lib/utils"

import { focusRing, measure } from "./editorial"
import { SectionHeading } from "./section-heading"

const faqs = [
  {
    q: "What do I need?",
    a: "A Mac with Apple Silicon, a Claude Code or Codex account, and a repository with a dev server. GitHub is only needed to open pull requests.",
  },
  {
    q: "What is Screenplay, exactly?",
    a: "A canvas for coding agents. Every Workspace is a git branch with its own sandbox and dev server, rendered as a live frame. Your agents write code in those Workspaces, and you compare the results side by side instead of one checkout at a time.",
  },
  {
    q: "Which agents does it work with?",
    a: "Claude Code and Codex, using the CLIs and accounts you already have. opencode runs in terminal tabs but not in chat. A self-hosted deployment also has a built-in agent that talks to Anthropic, OpenAI, Google, the Vercel AI Gateway or any OpenAI-compatible endpoint.",
  },
  {
    q: "Does my code leave my machine?",
    a: "Only through your agent. The desktop app has no account and no Screenplay servers, and everything it stores stays on your Mac. Your agent sends code to its model provider just as it does in your terminal, including your README and configs when it works out how to run a new repository.",
  },
  {
    q: "How does the multiplayer part work?",
    a: "Deploy the web app and each Workspace runs in a hosted sandbox VM. Share a canvas and everyone sees the same frames, cursors, comments and agent streams in real time. The reference deployment uses Vercel, Postgres, Liveblocks, Vercel Blob, Vercel Sandbox, a GitHub OAuth app and at least one model provider key.",
  },
  {
    q: "Do I need to change my app?",
    a: "No. Anything with a dev server works, as long as it listens on the port Screenplay gives it. For knobs or state shared between viewers, add the two small npm packages. They no-op in production builds.",
  },
  {
    q: "What does it cost?",
    a: "The software is free and MIT licensed. You bring your own agent subscriptions or API keys, and a self-hosted deployment pays for its hosting and model usage.",
  },
]

export function Faq() {
  return (
    <section className={cn(measure, "pt-[clamp(72px,10vw,140px)]")}>
      <SectionHeading slug="FAQ" title="Before you download." />
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
