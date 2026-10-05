import { cn } from "@workspace/ui/lib/utils"

import { docsUrl } from "@/lib/app-url"
import { PerkAgent, PerkChat, PerkComments, PerkLive } from "../excerpts/perks"
import { buttonClass, measure, sectionTop } from "./editorial"
import { SectionHeading } from "./section-heading"

const h3 = "font-heading text-[20px] leading-[1.2] font-normal tracking-[-0.03em]"
const bodyText = "text-[15px] leading-normal text-muted-foreground"

/** What the hosted web app adds to the desktop app. */
const perks = {
  live: {
    title: "Live frames",
    body: "Frames open as each person’s own copy. Click Go live and everyone on the canvas is on one browser, watching each click.",
  },
  agent: {
    title: "The agent at the controls",
    body: "Ask a chat to show you what it built. It clicks, types and hovers in the live frame with real input, and everyone watching sees each step.",
  },
  comments: {
    title: "Comments on the UI",
    body: "Pin a comment to any element in a frame or a passage in a document, and discuss it in a thread. Play mode shows the same threads.",
  },
  chats: {
    title: "Shared agent chats",
    body: "Watch a teammate’s agent work live, then carry on in the same chat. Every message names its sender, and commits go out under their name.",
  },
  repos: {
    title: "Repositories set up once",
    body: "Save how a repository runs, with its environment variables, to your account and add it to any canvas. Only you can see the values.",
  },
  models: {
    title: "Any model provider",
    body: "The built-in agent runs on Anthropic, OpenAI, Google, the Vercel AI Gateway or any OpenAI-compatible endpoint. Pick the model per chat.",
  },
}

/** The heading and pitch, as the other story sections set theirs, then the
 *  guide. One column, since every perk below brings its own picture. */
function TeamsHead() {
  return (
    <>
      <SectionHeading
        slug="For teams"
        title="Host it and build together."
        body="Deploy the web app and your team shares one canvas from any browser, with everyone’s cursors on it. Every chat runs in its own cloud sandbox, so nobody installs anything. The software is free and MIT licensed; you pay for hosting and model usage."
      />
      <a
        href={`${docsUrl}/self-hosting`}
        className={cn(buttonClass("outline", "lg"), "mt-8")}
      >
        Self-hosting guide
      </a>
    </>
  )
}

/** For teams: a picture for each multiplayer perk, then the rest. */
export function SelfHosting() {
  const pictured = [
    [perks.live, PerkLive],
    [perks.agent, PerkAgent],
    [perks.comments, PerkComments],
    [perks.chats, PerkChat],
  ] as const
  return (
    <section id="self-hosting" className={cn(measure, sectionTop)}>
      <TeamsHead />
      <ul className="mt-12 grid gap-x-12 border-t border-foreground md:grid-cols-2">
        {pictured.map(([p, Pic]) => (
          <li
            key={p.title}
            className="flex min-w-0 flex-col gap-3 border-b border-border pt-6 pb-8"
          >
            <Pic />
            <h3 className={cn(h3, "mt-2")}>{p.title}</h3>
            <p className={bodyText}>{p.body}</p>
          </li>
        ))}
      </ul>
      <ul className="grid gap-x-12 md:grid-cols-2">
        {[perks.repos, perks.models].map((p) => (
          <li
            key={p.title}
            className="flex min-w-0 flex-col gap-2.5 border-b border-border py-6.5"
          >
            <h3 className={h3}>{p.title}</h3>
            <p className={bodyText}>{p.body}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
