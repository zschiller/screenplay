import type { StaticImageData } from "next/image"

import { cn } from "@workspace/ui/lib/utils"

import prDark from "../shots/scene-pr.dark.webp"
import prLight from "../shots/scene-pr.light.webp"
import repoDark from "../shots/scene-repo.dark.webp"
import repoLight from "../shots/scene-repo.light.webp"
import runDark from "../shots/scene-run.dark.webp"
import runLight from "../shots/scene-run.light.webp"
import takesDark from "../shots/scene-takes.dark.webp"
import takesLight from "../shots/scene-takes.light.webp"
import { measure, monoLabel, ProductShot } from "./editorial"
import { SectionHeading } from "./section-heading"

const scenes: {
  slug: string
  title: string
  body: string
  shot: [StaticImageData, StaticImageData]
  alt: string
}[] = [
  {
    slug: "Scene 1",
    title: "Point it at a repo",
    body: "Add a repository and Screenplay boots its dev server in a sandbox. That's your main Workspace, live on the canvas.",
    shot: [repoLight, repoDark],
    alt: "Home, with recent canvases.",
  },
  {
    slug: "Scene 2",
    title: "Call for takes",
    body: "Ask your agent for three directions. Each gets its own Workspace: a real git branch with its own running sandbox.",
    shot: [takesLight, takesDark],
    alt: "Creating two Workspaces at once, each with its own prompt.",
  },
  {
    slug: "Scene 3",
    title: "Watch them all run",
    body: "Frames appear side by side as they build. Click through them, resize to mobile, tweak knobs. Invite the team to poke around.",
    shot: [runLight, runDark],
    alt: "Desktop and mobile frames of the same page running side by side.",
  },
  {
    slug: "Scene 4",
    title: "Print the winner",
    body: "Keep iterating on the one you love, then open a pull request straight from the canvas. Cut the rest.",
    shot: [prLight, prDark],
    alt: "A Workspace's menu, with Create pull request at the top.",
  },
]

export function Scenes() {
  return (
    <section
      id="how"
      className={cn(measure, "scroll-mt-20 pt-[clamp(72px,10vw,140px)]")}
    >
      <SectionHeading
        slug="Ext. The canvas — day"
        title="From one prompt to a wall of working prototypes."
        body="Screenplay turns “what if we tried…” into something everyone can click, in about the time it takes to refill your coffee."
      />
      <ol className="mt-14 grid gap-x-9 border-t border-foreground sm:grid-cols-2 lg:grid-cols-4">
        {scenes.map(({ slug, title, body, shot, alt }, i) => (
          <li
            key={slug}
            className={cn(
              "relative flex min-w-0 flex-col gap-3 pt-4.5 pb-8",
              // A hairline in the gutter between columns, so every column
              // (and every image) is the same width.
              "before:absolute before:inset-y-0 before:-left-4.5 before:w-px before:bg-border",
              "before:hidden",
              i % 2 === 1 && "sm:before:block",
              i !== 0 && "lg:before:block"
            )}
          >
            <span className={cn(monoLabel, "text-muted-foreground")}>
              {slug}
            </span>
            <h3 className="font-heading text-[30px] leading-[1.05] font-normal">
              {title}
            </h3>
            <ProductShot
              light={shot[0]}
              dark={shot[1]}
              alt={alt}
              sizes="(min-width: 1024px) 270px, (min-width: 640px) 50vw, 100vw"
            />
            <p className="text-[15px] leading-normal text-muted-foreground">
              {body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}
