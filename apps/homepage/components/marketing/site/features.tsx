import { cn } from "@workspace/ui/lib/utils"

import { measure } from "./editorial"
import { SectionHeading } from "./section-heading"

const features: { title: string; body: string }[] = [
  {
    title: "Live sandboxes",
    body: "Every frame is a running dev server on its own branch. Click, scroll, fill in forms and switch to mobile sizes.",
  },
  {
    title: "The Coordinator",
    body: "One chat for the whole canvas. Ask what changed in each Workspace, or have it start new ones, for versions of one change or separate tasks in parallel.",
  },
  {
    title: "Pick elements",
    body: "Press ⌘E and click an element in any frame to send it to the agent as context.",
  },
  {
    title: "Knobs",
    body: "Ask the agent to expose spacing, color or copy as knobs, then drag a slider to try values in a frame without another prompt.",
  },
  {
    title: "Your agents and models",
    body: "Use Claude Code or Codex with the subscription you already have, and pick the model per chat.",
  },
  {
    title: "Runs on your Mac",
    body: "No account and no Screenplay servers. Sandboxes are git worktrees on your disk and your canvases live in a local database. Your agent talks to its model provider, just as it does in your terminal.",
  },
]

export function Features() {
  return (
    <section
      id="features"
      className={cn(measure, "scroll-mt-20 pt-[clamp(72px,10vw,140px)]")}
    >
      <SectionHeading
        slug="Features"
        title="Built for comparing what your agents build."
      />
      <div className="mt-12 grid border-t border-border md:grid-cols-3 md:gap-x-13">
        {features.map((f, i) => (
          <div
            key={f.title}
            className={cn(
              "relative flex flex-col gap-2.5 py-6.5",
              // Hairlines under each row, carried across the gutter, and in
              // the gutter between columns.
              "after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border",
              i % 3 !== 2 && "md:after:-right-13",
              i % 3 !== 0 &&
                "md:before:absolute md:before:inset-y-0 md:before:-left-6.5 md:before:w-px md:before:bg-border"
            )}
          >
            <h3 className="font-heading text-[20px] leading-[1.2] font-normal tracking-[-0.03em]">
              {f.title}
            </h3>
            <p className="text-[15.5px] leading-normal text-muted-foreground">
              {f.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
