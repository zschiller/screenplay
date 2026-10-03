import { cn } from "@workspace/ui/lib/utils"

import {
  DesignToolExcerpt,
  DocsToolExcerpt,
  TerminalExcerpt,
} from "../excerpts/tools"
import { measure, monoLabel, sectionTop } from "./editorial"
import { SectionHeading } from "./section-heading"

/** Where a change lives without Screenplay: the three places How it works
 *  brings onto one canvas. */
const places = [
  { caption: "The plan · a docs tool", Excerpt: DocsToolExcerpt },
  { caption: "The mockup · a design tool", Excerpt: DesignToolExcerpt },
  { caption: "The build · a terminal", Excerpt: TerminalExcerpt },
]

export function Problem() {
  return (
    <section className={cn(measure, sectionTop)}>
      <SectionHeading
        slug="The problem"
        title="The plan, the mockup and the code live in three places."
        body="A spec in one doc, a mockup in a design tool that has never seen your components, and the build in a terminal and a browser tab. Every handoff starts from scratch."
      />

      <div className="mt-12 grid gap-x-9 gap-y-8 sm:grid-cols-3">
        {places.map(({ caption, Excerpt }) => (
          <div key={caption} className="flex min-w-0 flex-col gap-2.5">
            <Excerpt />
            <p className={cn(monoLabel, "text-muted-foreground")}>{caption}</p>
          </div>
        ))}
      </div>
    </section>
  )
}
