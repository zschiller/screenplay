import { cn } from "@workspace/ui/lib/utils"

import { focusRing, measure, sectionTop } from "./editorial"
import { SectionHeading } from "./section-heading"

const faqs = [
  {
    q: "What is Screenplay?",
    a: "A canvas where coding agents plan, mock up and build from your own repository. Each version of a change runs live on a branch of its own, side by side with the others, and you open a pull request for the one you keep.",
  },
  {
    q: "Which agents does it work with?",
    a: "The Mac app runs Claude Code, Codex or OpenCode, using the one you already have installed and its login, subscriptions included. The hosted web app has a built-in agent that runs on Anthropic, OpenAI, Google, the Vercel AI Gateway or any OpenAI-compatible endpoint.",
  },
  {
    q: "Should I use the Mac app or host it?",
    a: "Use the Mac app to work on your own. It needs no account, and your canvases stay on your Mac. Host the web app when a team should share canvases, comments and running apps from any browser. There’s no Screenplay-run service to sign up for; you deploy it yourself.",
  },
  {
    q: "What do I need for the Mac app?",
    a: "A Mac with Apple Silicon, Claude Code, Codex or OpenCode installed and signed in, and a project with a dev server. There’s no build for Intel Macs, Windows or Linux; on those, use a hosted deployment in the browser.",
  },
  {
    q: "Do I need GitHub?",
    a: "Not for the Mac app. Open a folder on your Mac or paste any clone URL; GitHub only adds browsing your repositories and opening pull requests. The hosted web app signs everyone in with GitHub and works on GitHub repositories.",
  },
  {
    q: "Does my code leave my machine?",
    a: "Only through your agent. The Mac app has no account and no Screenplay servers, and everything it stores stays on your Mac. Your agent sends code to its model provider just as it does in your terminal, including your README and config files when it works out how to run a new repository.",
  },
  {
    q: "Do I need to change my app?",
    a: "No. Anything with a dev server works, as long as it listens on the port Screenplay gives it. For knobs or state shared between viewers, add the two small npm packages. They do nothing in production builds.",
  },
  {
    q: "What does hosting it take?",
    a: "The reference deployment uses Vercel, Postgres, Liveblocks, Vercel Blob, Vercel Sandbox, a GitHub OAuth app and at least one model provider key. Every chat runs in its own cloud sandbox, so your team installs nothing. The self-hosting guide shows how to swap in other providers.",
  },
  {
    q: "Is it free and open source?",
    a: "Yes. Screenplay is MIT licensed and the code is on GitHub. You bring your own agent subscriptions or API keys, and a hosted deployment pays for its own hosting and model usage.",
  },
]

export function Faq() {
  return (
    <section className={cn(measure, sectionTop)}>
      <SectionHeading slug="FAQ" title="Before you start." tier="reference" />
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
