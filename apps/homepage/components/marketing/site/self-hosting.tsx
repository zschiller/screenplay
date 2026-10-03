import { cn } from "@workspace/ui/lib/utils"

import { docsUrl } from "@/lib/app-url"
import { TeamExcerpt } from "../excerpts/team"
import { buttonClass, measure, sectionTop } from "./editorial"
import { FeatureGrid } from "./features"
import { SectionHeading } from "./section-heading"

/** What the hosted web app adds to the desktop app. */
const perks = [
  {
    title: "Shared live frames",
    body: "Each frame is one browser running in its Workspace's sandbox. When someone clicks through it, everyone watching sees it happen, and anyone can ask for control.",
  },
  {
    title: "The agent at the controls",
    body: "Ask a chat to show you what it built. It clicks, types and hovers in the shared frame with real input, and everyone watching sees each step.",
  },
  {
    title: "Comments on the UI",
    body: "Pin a comment to any element in a frame or a passage in a document, and discuss it in a thread. Play mode shows the same threads.",
  },
  {
    title: "Shared agent chats",
    body: "Watch a teammate's agent work live, then carry on in the same chat. Every message names its sender, and commits go out under their name.",
  },
  {
    title: "Repositories set up once",
    body: "Save how a repository runs, with its environment variables, to your account and add it to any canvas. Only you can see the values.",
  },
  {
    title: "Any model provider",
    body: "The built-in agent runs on Anthropic, OpenAI, Google, the Vercel AI Gateway or any OpenAI-compatible endpoint. Pick the model per chat.",
  },
]

export function SelfHosting() {
  return (
    <section id="self-hosting" className={cn(measure, sectionTop)}>
      <SectionHeading slug="For teams" title="Host it and build together." />
      <div className="mt-12 grid items-start gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col items-start gap-8">
          <p className="max-w-[44ch] text-lg leading-relaxed text-muted-foreground sm:text-[19px]">
            Deploy the web app and your team shares one canvas from any browser,
            with everyone&apos;s cursors on it. Every Workspace runs in its own
            cloud sandbox, so nobody installs anything. The software is free and
            MIT licensed; you pay for hosting and model usage.
          </p>
          <a
            href={`${docsUrl}/self-hosting`}
            className={buttonClass("outline", "lg")}
          >
            Self-hosting guide
          </a>
        </div>
        <TeamExcerpt />
      </div>
      <FeatureGrid items={perks} className="mt-12" />
    </section>
  )
}
