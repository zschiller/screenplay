import { cn } from "@workspace/ui/lib/utils"

import {
  DocExcerpt,
  DrawFrameExcerpt,
  PrHeaderExcerpt,
  SketchExcerpt,
} from "../excerpts/make"
import { measure, monoLabel, sectionTop } from "./editorial"
import { SectionHeading } from "./section-heading"

const scenes: {
  slug: string
  title: string
  body: string
  Excerpt: () => React.JSX.Element
}[] = [
  {
    slug: "Documents",
    title: "Plan it",
    body: "A plan or a spec, written as a document next to the work. It stays current as things change.",
    Excerpt: DocExcerpt,
  },
  {
    slug: "Mockups",
    title: "Sketch it",
    body: "Mockups made with your own components, styles and copy. Compare a few takes before anything gets built.",
    Excerpt: SketchExcerpt,
  },
  {
    slug: "Your app",
    title: "Build it",
    body: "The change runs live on a branch of its own, right beside the other versions.",
    Excerpt: DrawFrameExcerpt,
  },
  {
    slug: "Ship",
    title: "Ship it",
    body: "Open a pull request for the version you keep.",
    Excerpt: PrHeaderExcerpt,
  },
]

export function Scenes() {
  return (
    <section id="how" className={cn(measure, sectionTop)}>
      <SectionHeading
        slug="How it works"
        title="Plan it, sketch it, build it."
        body="Type a prompt anywhere on the canvas and an agent makes it right there. It reads your code first, so whatever it makes fits your app."
      />
      <ol className="mt-12 grid gap-x-9 border-t border-foreground sm:grid-cols-2 lg:grid-cols-4 lg:grid-rows-[repeat(4,auto)]">
        {scenes.map(({ slug, title, body, Excerpt }, i) => (
          <li
            key={slug}
            className={cn(
              "relative flex min-w-0 flex-col gap-3 pt-4.5 pb-8",
              // One row per part across the columns, so the pictures lead
              // and a title that wraps doesn't push the others' text down.
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
            <Excerpt />
            <span className={cn(monoLabel, "mt-2 text-muted-foreground")}>
              {slug}
            </span>
            <h3 className="font-heading text-[20px] leading-[1.2] font-normal tracking-[-0.03em]">
              {title}
            </h3>
            <p className="text-[15px] leading-normal text-muted-foreground">
              {body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}
