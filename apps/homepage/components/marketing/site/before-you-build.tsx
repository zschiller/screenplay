import { cn } from "@workspace/ui/lib/utils"

import { MockupExcerpt } from "../excerpts/mockup"
import { measure, sectionTop } from "./editorial"
import { SectionHeading } from "./section-heading"

const items = [
  {
    title: "Mockups",
    body: "A chat draws takes as static pages beside the live frame. Mark each one Current, Set aside or Built, then ask it to build the one you want.",
  },
  {
    title: "Documents",
    body: "Chats write specs and plans as documents on the canvas and keep them up to date. Select a passage to ask about it in chat.",
  },
  {
    title: "Plan mode",
    body: "Ask for a plan first and approve it before any code changes, in Claude Code or Codex.",
  },
]

/** What a chat can do before it writes code, laid out as Self-hosting is. */
export function BeforeYouBuild() {
  return (
    <section id="before-you-build" className={cn(measure, sectionTop)}>
      <SectionHeading
        slug="Before you build"
        tier="reference"
        title="Settle the idea before the agents write code."
      />
      <div className="mt-12 grid items-start gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col items-start gap-8">
          <p className="max-w-[44ch] text-lg leading-relaxed text-muted-foreground sm:text-[19px]">
            Every chat can sketch and plan as well as build, so the options and
            the reasoning sit on the canvas next to the running app.
          </p>
          <div className="w-full">
            {items.map((item) => (
              <div
                key={item.title}
                className="flex flex-col gap-1.5 border-t border-border py-4.5 first:border-foreground last:border-b"
              >
                <h3 className="font-heading text-[20px] leading-[1.2] font-normal tracking-[-0.03em]">
                  {item.title}
                </h3>
                <p className="text-pretty text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
        <MockupExcerpt />
      </div>
    </section>
  )
}
