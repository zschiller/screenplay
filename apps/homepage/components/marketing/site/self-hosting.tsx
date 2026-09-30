import { cn } from "@workspace/ui/lib/utils"

import { docsUrl, githubUrl } from "@/lib/app-url"
import { measure } from "./editorial"
import { SectionHeading } from "./section-heading"

const perks = [
  {
    title: "One canvas for the team",
    body: "Everyone sees the same running frames, with cursors and avatars. Click an avatar to follow that person's view.",
  },
  {
    title: "Comments on the UI",
    body: "Pin a comment to any element in a frame and discuss it in a thread.",
  },
  {
    title: "Shared agent chats",
    body: "Watch a teammate's agent work live, then carry on in the same chat.",
  },
]

export function SelfHosting() {
  return (
    <section
      id="self-hosting"
      className={cn(measure, "scroll-mt-20 pt-[clamp(72px,10vw,140px)]")}
    >
      <SectionHeading
        slug="Self-hosting"
        title="Host it and review together."
      />
      <div className="mt-12 grid gap-12 md:grid-cols-2">
        <div className="flex flex-col items-start gap-5 md:pt-3.5">
          <p className="max-w-[44ch] text-lg leading-relaxed text-muted-foreground sm:text-[19px]">
            Deploy the web app for your team and share a canvas. It&rsquo;s free
            and MIT licensed.
          </p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <a
              href={`${docsUrl}/self-hosting`}
              className="font-mono text-sm underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
            >
              Self-hosting guide
            </a>
            <a
              href={githubUrl}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-sm underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
            >
              github.com/zschiller/screenplay
            </a>
          </div>
        </div>
        <div>
          {perks.map((p) => (
            <div
              key={p.title}
              className="flex flex-col gap-1.5 border-t border-border py-4.5 last:border-b"
            >
              <h3 className="font-heading text-[17px] leading-[1.25] font-normal tracking-[-0.03em]">
                {p.title}
              </h3>
              <p className="text-pretty text-muted-foreground">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
