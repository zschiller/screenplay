import { cn } from "@workspace/ui/lib/utils"

import { githubUrl } from "@/lib/app-url"
import { buttonClass, measure, sectionTop } from "./editorial"
import { FeatureGrid } from "./features"
import { SectionHeading } from "./section-heading"

const ways = [
  {
    title: "Fork it",
    body: "Copy the repository and change whatever you like. The MIT license lets you run, modify and ship your own version.",
  },
  {
    title: "Contribute",
    body: "Open an issue for a bug or an idea, or send a pull request. Changes that help everyone go back into Screenplay.",
  },
  {
    title: "Build it with Screenplay",
    body: "Add the Screenplay repository to a canvas and ask for a few versions of your change, the same way you work on your own code.",
  },
]

/** Open source: the code is yours to change, with the repo one click away. */
export function OpenSource() {
  return (
    <section id="open-source" className={cn(measure, sectionTop)}>
      <SectionHeading
        slug="Open source"
        tier="reference"
        title="Don’t like how something works? Change it."
        body="Screenplay is free and open source. Every line of the app is on GitHub, so you can fork it and make it yours, or contribute the change for everyone."
      />
      <a
        href={githubUrl}
        target="_blank"
        rel="noreferrer"
        className={cn(buttonClass("outline", "lg"), "mt-8")}
      >
        View on GitHub
      </a>
      <FeatureGrid items={ways} className="mt-12" />
    </section>
  )
}
