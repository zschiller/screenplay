import { cn } from "@workspace/ui/lib/utils"

import { measure } from "./editorial"
import { SectionHeading } from "./section-heading"

const features: { title: string; body: React.ReactNode }[] = [
  {
    title: "Real sandboxes, not screenshots",
    body: "Every frame is a live dev server on its own branch. Click, scroll, fill in forms, flip to mobile. It's the actual app.",
  },
  {
    title: "Multiplayer by default",
    body: "Deploy the web app and share a link. Everyone sees the same canvas, cursors, comments and running branches. Follow a teammate with one click.",
  },
  {
    title: "Point at anything",
    body: "Hit ⌘E, click an element in any frame, and send it to the agent. No more “the button, no, the other button.”",
  },
  {
    title: "Knobs for every take",
    body: (
      <>
        Your agent exposes spacing, color and copy as knobs with{" "}
        <code className="font-mono text-[13px] text-foreground">
          @screenplay.space/knobs
        </code>
        . Drag a slider and watch every branch respond, no re-prompting.
      </>
    ),
  },
  {
    title: "Bring your own harness",
    body: "Run Claude Code, Codex or opencode with the models you already pay for. Switch models per chat.",
  },
  {
    title: "Local-first on your Mac",
    body: "The desktop app runs entirely offline: git worktrees for sandboxes, your installed CLIs for agents. Your code stays put.",
  },
]

export function Features() {
  return (
    <section
      id="features"
      className={cn(measure, "scroll-mt-20 pt-[clamp(72px,10vw,140px)]")}
    >
      <SectionHeading
        slug="Int. The writers' room — continuous"
        title="Everything a canvas needs to direct a room full of agents."
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
