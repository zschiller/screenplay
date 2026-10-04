import * as React from "react"

import { Button } from "@workspace/ui/components/button"
import { Textarea } from "@workspace/ui/components/textarea"
import { cn } from "@workspace/ui/lib/utils"

/** Small mono section label; `accent` for the one that matters most. */
export function Label({
  accent,
  className,
  ...props
}: React.ComponentProps<"p"> & { accent?: boolean }) {
  return (
    <p
      className={cn(
        "m-0 font-mono text-xs font-medium tracking-wider uppercase",
        accent ? "text-info" : "text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

/** Data fields may hold inline HTML; agents write them. */
export function Html<T extends "p" | "span" | "li" | "div" | "blockquote">({
  as,
  html,
  ...props
}: { as: T; html: string } & Omit<
  React.ComponentProps<T>,
  "children" | "dangerouslySetInnerHTML"
>) {
  return React.createElement(as, {
    ...props,
    dangerouslySetInnerHTML: { __html: html },
  })
}

export function Facts({ items }: { items: string | string[] }) {
  return (
    <ul className="m-0 flex max-w-[72ch] flex-col gap-2.5 pl-4.5 text-sm marker:text-muted-foreground">
      {[items].flat().map((x, i) => (
        <Html as="li" key={i} html={x} />
      ))}
    </ul>
  )
}

/** Saved per page in localStorage; a private window just starts empty. */
export function load<T>(key: string): Partial<T> {
  try {
    return JSON.parse(localStorage.getItem(key) || "{}")
  } catch {
    return {}
  }
}
export function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage blocked: picks just don't survive a reload.
  }
}

/**
 * The bar pinned to the bottom: picks so far, a note, and Copy. When the
 * clipboard is blocked the text shows in a box, selected, to copy by hand.
 */
export function CopyBar({
  status,
  note,
  setNote,
  noteOpen,
  setNoteOpen,
  copyLabel,
  outLabel,
  text,
  maxWidth,
}: {
  status: React.ReactNode
  note: string
  setNote: (note: string) => void
  noteOpen: boolean
  setNoteOpen: (open: boolean) => void
  copyLabel: string
  outLabel: string
  text: () => string
  maxWidth: string
}) {
  const [copied, setCopied] = React.useState(false)
  const [out, setOut] = React.useState<string | null>(null)
  const noteRef = React.useRef<HTMLTextAreaElement>(null)
  const outRef = React.useRef<HTMLTextAreaElement>(null)
  React.useEffect(() => {
    if (out != null) outRef.current?.select()
  }, [out])
  // Opening the note, from Note or from a pick that asks for one, focuses it
  const wasOpen = React.useRef(noteOpen)
  React.useEffect(() => {
    if (noteOpen && !wasOpen.current) noteRef.current?.focus()
    wasOpen.current = noteOpen
  }, [noteOpen])
  const copy = () => {
    const value = text()
    const fallback = () => setOut(value)
    try {
      navigator.clipboard.writeText(value).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1800)
      }, fallback)
    } catch {
      fallback()
    }
  }
  return (
    <div className="fixed inset-x-0 bottom-0 z-[8] border-t bg-background px-4 pt-2.5 pb-[calc(10px+env(safe-area-inset-bottom,0px))] md:px-6">
      <div className="mx-auto flex flex-col gap-2.5" style={{ maxWidth }}>
        <Textarea
          ref={noteRef}
          aria-label="Note"
          placeholder="Anything to add"
          hidden={!noteOpen}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="min-h-18 resize-y text-sm md:text-sm"
        />
        <Textarea
          ref={outRef}
          aria-label={outLabel}
          readOnly
          hidden={out == null}
          value={out ?? ""}
          className="min-h-18 resize-y font-mono text-xs md:text-xs"
        />
        <div className="flex items-center gap-2">
          <div
            role="status"
            aria-live="polite"
            className="line-clamp-2 min-w-0 flex-1 text-sm text-muted-foreground [&_b]:font-medium [&_b]:text-foreground"
          >
            {status}
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setNoteOpen(!noteOpen)}
          >
            Note
          </Button>
          {/* Keeps its width while it says Copied: both labels share one grid cell */}
          <Button type="button" onClick={copy} className="inline-grid">
            <span className="[grid-area:1/1]">
              {copied ? "Copied" : copyLabel}
            </span>
            <span aria-hidden className="invisible [grid-area:1/1]">
              {copyLabel}
            </span>
          </Button>
        </div>
      </div>
    </div>
  )
}
