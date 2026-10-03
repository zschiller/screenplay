import {
  BookOpenIcon,
  CaretDownIcon,
  ClipboardTextIcon,
  CrosshairIcon,
  FilePdfIcon,
  NotepadIcon,
} from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"

import {
  Frame,
  UserBubble,
  versions,
} from "./canvas"
import { Fit } from "./fit"
import { ChatHeader, Send, ToolRow } from "./make"
import { Northwind } from "./northwind"
import { surface } from "./steps"
import {
} from "./team"

const dark = versions[2]

const skills = [
  [
    "brand-voice",
    "Canvas",
    "Write UI copy in Northwind's voice: plain sentences, no exclamation marks.",
  ],
  [
    "release-notes",
    "Account",
    "Draft release notes from the pull requests merged since the last tag.",
  ],
  [
    "screenplay-add-knob",
    "Built in",
    "Add interactive controls (sliders, switches, selects, tabs, color pickers…",
  ],
] as const

/**
 * The context picture: a chat that took an attached brand guide, saved a rule
 * to canvas memory, and the composer with / open on skills from the canvas,
 * the account and Screenplay.
 */
export function MemoryExcerpt() {
  return (
    <Fit
      width={640}
      height={520}
      initialScale={0.9}
      role="img"
      aria-label="A chat beside the Dark hero frame: a message with a brand guide attached, the agent saving a rule to canvas memory, and the message box with the / menu open on skills from the canvas, the account and Screenplay."
      className="border border-border"
    >
      <div className="flex size-full text-foreground">
        <div className="bg-plane relative w-[200px] shrink-0 overflow-hidden">
          <Frame
            label="Home"
            workspace={dark.title}
            selected
            style={{ left: 20, top: 60, width: 300 }}
          >
            <Northwind version={dark.version} />
          </Frame>
        </div>
        <div className="flex min-w-0 flex-1 flex-col border-l border-border bg-background">
          <ChatHeader title={dark.title} diff={dark.diff} pr={false} />
          <div className="relative flex flex-1 flex-col gap-3 overflow-hidden px-3 py-3.5 text-[13px] leading-normal">
            <div className="flex flex-col items-end gap-1.5">
              <span className="flex h-7 items-center gap-1.5 rounded-lg bg-input/50 px-2.5 text-xs">
                <FilePdfIcon className="size-3.5 text-muted-foreground" />
                brand-guide.pdf
              </span>
              <UserBubble className="ml-12">
                Use the purple from the brand guide for every accent, never
                blue.
              </UserBubble>
            </div>
            <ToolRow
              icon={<NotepadIcon />}
              verb="Save to canvas memory"
              detail="Accents use the brand purple, never blue."
            />
            <p>
              Saved for every chat on this canvas. The buttons and the chart
              use the brand purple now.
            </p>
            {/* The / menu, over the transcript, above the composer. */}
            <div
              className={cn(
                surface,
                "absolute inset-x-3 bottom-1 flex flex-col p-1 text-[13px]"
              )}
            >
              <span className="px-2 pt-1.5 pb-1 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
                Skills
              </span>
              {skills.map(([name, from, desc], i) => (
                <div
                  key={name}
                  className={cn(
                    "flex gap-2 rounded-md px-2 py-1.5",
                    i === 0 && "bg-accent"
                  )}
                >
                  <BookOpenIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {from}
                      </span>
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {desc}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="m-3 mt-1 flex flex-col gap-3 rounded-lg border border-border p-3 text-[13px]">
            <span>/</span>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1">
                Opus 5.5
                <CaretDownIcon className="size-3 text-muted-foreground" />
              </span>
              <span className="flex items-center gap-1 [&_svg]:size-3.5">
                <ClipboardTextIcon />
                Plan
              </span>
              <CrosshairIcon className="size-3.5 text-muted-foreground" />
              <Send className="ml-auto" />
            </div>
          </div>
        </div>
      </div>
    </Fit>
  )
}
