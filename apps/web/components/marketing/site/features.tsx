import { cn } from "@workspace/ui/lib/utils"

import { measure } from "./editorial"
import { SectionHeading } from "./section-heading"

const features: { title: string; body: React.ReactNode }[] = [
  {
    title: "Live sandboxes",
    body: "Every frame is a running dev server on its own branch. Click, scroll, fill in forms and switch to mobile sizes.",
  },
  {
    title: "Multiplayer",
    body: "Deploy the web app and share a link. Everyone sees the same canvas, cursors, comments and running branches. Follow a teammate with one click.",
  },
  {
    title: "Pick elements",
    body: "Press ⌘E and click an element in any frame to send it to the agent as context.",
  },
  {
    title: "Knobs",
    body: (
      <>
        Your agent exposes spacing, color and copy as knobs with{" "}
        <code className="font-mono text-[13px] text-foreground">
          @screenplay.space/knobs
        </code>
        . Drag a slider and every branch updates without another prompt.
      </>
    ),
  },
  {
    title: "Your agents and models",
    body: "Run Claude Code, Codex or opencode with the accounts you already have. Choose the model per chat.",
  },
  {
    title: "Runs locally on your Mac",
    body: "The desktop app works offline: git worktrees for sandboxes, your installed CLIs for agents. Your code stays on your machine.",
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
      <div className="mt-14 grid border-t border-border md:grid-cols-3 md:gap-x-13">
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
            <h3 className="font-heading text-[28px] leading-[1.05] font-normal">
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
