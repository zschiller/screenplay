import { cn } from "@workspace/ui/lib/utils"

import { Card } from "./steps"

/*
 * The tools a change passes through without Screenplay, for the Problem
 * section: a docs tool, a design tool and a terminal. Generic windows, so no
 * product is named; each sits in the same 320×256 card as the How it works
 * excerpts below it.
 */

/** A desktop window: three dots and the document's name, then its content. */
function Window({
  name,
  terminal,
  children,
}: {
  name: string
  terminal?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "absolute inset-3 flex flex-col overflow-hidden border border-border",
        // A terminal is black in both themes.
        terminal ? "bg-black" : "bg-background"
      )}
    >
      <div className="flex h-6 shrink-0 items-center gap-1.5 border-b border-border px-2.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 rounded-full bg-foreground/20" />
        ))}
        <span className="ml-2 text-[10px] text-muted-foreground">{name}</span>
      </div>
      <div className="relative flex-1 p-3">{children}</div>
    </div>
  )
}

const line = "h-1.5 rounded-full bg-foreground/15"

/** The plan: a doc in a docs tool, last touched weeks ago. */
export function DocsToolExcerpt() {
  return (
    <Card label="A plan in a docs tool, last edited three weeks ago.">
      <Window name="Hero plan · Docs">
        <div className="flex flex-col gap-2">
          <span className="font-heading text-[14px] tracking-[-0.02em]">
            Hero plan
          </span>
          <span className="text-[9px] text-muted-foreground">
            Edited 3 weeks ago
          </span>
          <span className={cn(line, "w-[92%]")} />
          <span className={cn(line, "w-[80%]")} />
          <span className={cn(line, "w-[86%]")} />
          <span className="mt-1 font-heading text-[11px] tracking-[-0.02em]">
            Takes to try
          </span>
          <span className={cn(line, "w-[60%]")} />
          <span className={cn(line, "w-[70%]")} />
        </div>
      </Window>
    </Card>
  )
}

/** The mockup: grey boxes and placeholder copy, drawn from scratch. */
export function DesignToolExcerpt() {
  return (
    <Card label="A mockup drawn from scratch in a design tool: grey boxes and placeholder copy.">
      <Window name="Hero v2 · Design">
        <div className="absolute inset-0 flex">
          <div className="flex w-14 shrink-0 flex-col gap-1.5 border-r border-border p-2">
            {["Frame", "Header", "Hero", "Button", "Image"].map((l) => (
              <span key={l} className="text-[8px] text-muted-foreground">
                {l}
              </span>
            ))}
          </div>
          <div className="flex-1 p-2.5">
            <div className="flex h-full flex-col gap-2 bg-neutral-100 p-3 text-neutral-500">
              <div className="flex items-center justify-between">
                <span className="h-2 w-10 rounded-sm bg-neutral-300" />
                <span className="flex gap-1.5">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-5 bg-neutral-300" />
                  ))}
                </span>
              </div>
              <div className="mt-2 flex flex-1 gap-3">
                <div className="flex flex-1 flex-col gap-1.5">
                  <span className="text-[13px] leading-tight font-semibold text-neutral-700">
                    Headline goes here
                  </span>
                  <span className="text-[8px] leading-snug">
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit.
                  </span>
                  <span className="mt-1 h-4 w-14 rounded-full bg-sky-500" />
                </div>
                {/* An image placeholder: a box with a cross. */}
                <svg
                  className="flex-1 border border-neutral-300 bg-neutral-200 text-neutral-300"
                  preserveAspectRatio="none"
                  viewBox="0 0 10 10"
                >
                  <path
                    d="M0 0L10 10M10 0L0 10"
                    stroke="currentColor"
                    strokeWidth="1"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </Window>
    </Card>
  )
}

const dance = [
  ["$", "git worktree add ../dark hero-dark"],
  ["$", "cd ../dark && pnpm install"],
  ["$", "PORT=3001 pnpm dev"],
  ["", "▲ Ready on localhost:3001"],
] as const

/** The build: a worktree, an install and a dev server, by hand. */
export function TerminalExcerpt() {
  return (
    <Card label="A terminal setting up a worktree, an install and a dev server.">
      <Window name="zsh" terminal>
        <div className="font-mono text-[11px] leading-[1.9] text-neutral-200">
          {dance.map(([p, cmd], i) => (
            <div key={i} className="flex gap-2 whitespace-nowrap">
              {p ? <span className="text-neutral-500">{p}</span> : null}
              <span className={p === "$" ? "" : "text-neutral-500"}>{cmd}</span>
            </div>
          ))}
          <div className="flex gap-2">
            <span className="text-neutral-500">$</span>
            <span className="caret-blink h-3.5 w-1.5 translate-y-0.5 bg-neutral-400" />
          </div>
        </div>
      </Window>
    </Card>
  )
}
