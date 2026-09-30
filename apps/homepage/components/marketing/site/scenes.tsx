import { cn } from "@workspace/ui/lib/utils"

import {
  AddRepoExcerpt,
  CompareExcerpt,
  CreateWorkspacesExcerpt,
  PullRequestExcerpt,
} from "../excerpts/steps"
import { measure, monoLabel } from "./editorial"
import { SectionHeading } from "./section-heading"

const scenes: {
  slug: string
  title: string
  body: string
  Excerpt: () => React.JSX.Element
}[] = [
  {
    slug: "Step 1",
    title: "Add a repository",
    body: "Screenplay starts its dev server in a sandbox. That becomes your main Workspace, running on the canvas.",
    Excerpt: AddRepoExcerpt,
  },
  {
    slug: "Step 2",
    title: "Ask for versions",
    body: "Ask your agent for several approaches. Each one gets its own Workspace: a git branch with its own running sandbox.",
    Excerpt: CreateWorkspacesExcerpt,
  },
  {
    slug: "Step 3",
    title: "Compare them live",
    body: "Frames appear side by side as they build. Click through them, check mobile sizes and adjust knobs. Invite your team to review.",
    Excerpt: CompareExcerpt,
  },
  {
    slug: "Step 4",
    title: "Open a pull request",
    body: "Keep iterating on the version you want, then open a pull request from the canvas.",
    Excerpt: PullRequestExcerpt,
  },
]

export function Scenes() {
  return (
    <section
      id="how"
      className={cn(measure, "scroll-mt-20 pt-[clamp(72px,10vw,140px)]")}
    >
      <SectionHeading
        slug="How it works"
        title="From one prompt to several running versions."
        body="Describe a change once, let your agents build it several ways, and review every version on the same canvas."
      />
      <ol className="mt-12 grid gap-x-9 border-t border-foreground sm:grid-cols-2 lg:grid-cols-4 lg:grid-rows-[repeat(4,auto)]">
        {scenes.map(({ slug, title, body, Excerpt }, i) => (
          <li
            key={slug}
            className={cn(
              "relative flex min-w-0 flex-col gap-3 pt-4.5 pb-8",
              // One row per part across the columns, so a title that wraps
              // doesn't push its excerpt below the others'.
              "lg:row-span-4 lg:grid lg:grid-rows-subgrid lg:content-start",
              // At two columns, a hairline over the second row, carried
              // across the gutter like the Features grid's.
              i >= 2 &&
                "sm:max-lg:after:absolute sm:max-lg:after:inset-x-0 sm:max-lg:after:top-0 sm:max-lg:after:h-px sm:max-lg:after:bg-border",
              i === 2 && "sm:max-lg:after:-right-9",
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
            <h3 className="font-heading text-[22px] leading-[1.2] font-normal tracking-[-0.03em]">
              {title}
            </h3>
            <Excerpt />
            <p className="text-[15px] leading-normal text-muted-foreground">
              {body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}
