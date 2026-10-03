import { cn } from "@workspace/ui/lib/utils"

import { MemoryExcerpt } from "../excerpts/memory"
import { measure, sectionTop } from "./editorial"
import { SectionHeading } from "./section-heading"

const h3 = "font-heading text-[20px] leading-[1.2] font-normal tracking-[-0.03em]"

const contextItems = [
  {
    title: "Memory",
    body: "Chats save what you prefer and what the canvas has decided as short notes, for you on every canvas or for one canvas, and read them before every message.",
  },
  {
    title: "Files",
    body: "Research, references and PDFs stay in the canvas's files or yours, so the next chat picks up where the last one stopped.",
  },
  {
    title: "Skills",
    body: "Type / to use a skill from the repository, the canvas, your account or Screenplay. Chats save new ones when they learn a workflow.",
  },
  {
    title: "Attachments",
    body: "Drop a screenshot, PDF or text file on the message box. It's saved with the canvas's files for later chats.",
  },
]

/** What chats keep for the chats after them, laid out as For teams is. */
export function Memory() {
  return (
    <section id="memory" className={cn(measure, sectionTop)}>
      <SectionHeading
        slug="Memory and skills"
        tier="reference"
        title="Tell one chat, and every chat knows."
      />
      <div className="mt-12 grid items-start gap-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex flex-col items-start gap-8">
          <p className="max-w-[44ch] text-lg leading-relaxed text-muted-foreground sm:text-[19px]">
            Chats keep what they learn for the chats after them, so you stop
            repeating yourself.
          </p>
          <div className="w-full">
            {contextItems.map((item) => (
              <div
                key={item.title}
                className="flex flex-col gap-1.5 border-t border-border py-4.5 first:border-foreground last:border-b"
              >
                <h3 className={h3}>{item.title}</h3>
                <p className="text-pretty text-muted-foreground">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
        <MemoryExcerpt />
      </div>
    </section>
  )
}
