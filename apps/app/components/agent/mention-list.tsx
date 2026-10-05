"use client"

import {
  Fragment,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react"
import { cn } from "@workspace/ui/lib/utils"
import {
  MENTION_KIND_REGISTRY,
  type MentionCandidate,
} from "@/lib/mention-kinds"

/**
 * One row of the `@` list. Its `kind` groups it under the kind's heading and
 * carries onto the Mention node it inserts.
 */
export type MentionItem = MentionCandidate

export interface MentionListHandle {
  /** Forward an editor key event into the popover; returns true if consumed. */
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface MentionListProps {
  items: MentionItem[]
  command: (item: MentionItem) => void
}

/**
 * Suggestion popover for the chat / document body Mention extension, drawn
 * like the app's dropdown menus (the inverted surface, their labels and item
 * rows). Items arrive grouped by kind, each group under its heading, with
 * the kind's heading and icon from the mention kind registry.
 */
export const MentionList = forwardRef<MentionListHandle, MentionListProps>(
  function MentionList({ items, command }, ref) {
    const [selected, setSelected] = useState(0)

    useEffect(() => {
      // Reset highlight whenever the candidate set changes — otherwise the
      // index can land outside the array after the query narrows.
      setSelected(0)
    }, [items])

    const pick = (index: number) => {
      const item = items[index]
      if (item) command(item)
    }

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (items.length === 0) return false
        if (event.key === "ArrowDown") {
          setSelected((s) => (s + 1) % items.length)
          return true
        }
        if (event.key === "ArrowUp") {
          setSelected((s) => (s - 1 + items.length) % items.length)
          return true
        }
        if (event.key === "Enter") {
          pick(selected)
          return true
        }
        if (event.key === "Tab") {
          pick(selected)
          return true
        }
        return false
      },
    }))

    if (items.length === 0) {
      return (
        <div className="inverted w-max min-w-56 rounded-lg bg-popover px-2 py-1.5 text-sm text-muted-foreground shadow-md ring-1 ring-foreground/10">
          No matches
        </div>
      )
    }

    return (
      <div
        role="menu"
        className="inverted max-h-72 w-max max-w-70 min-w-56 overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10"
      >
        {items.map((item, i) => {
          const startsGroup = items[i - 1]?.kind !== item.kind
          const { heading, Icon } = MENTION_KIND_REGISTRY[item.kind]
          return (
            <Fragment key={`${item.kind}:${item.id}`}>
              {startsGroup && i > 0 && (
                <div role="separator" className="-mx-1 my-1 h-px bg-border" />
              )}
              {startsGroup && (
                <div className="px-1.5 py-1 font-mono text-xs font-normal tracking-wider whitespace-nowrap text-muted-foreground uppercase">
                  {heading}
                </div>
              )}
              <button
                type="button"
                role="menuitem"
                data-highlighted={i === selected ? "" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault()
                  command(item)
                }}
                onMouseEnter={() => setSelected(i)}
                className={cn(
                  "flex w-full cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm select-none [&_svg]:size-4 [&_svg]:shrink-0",
                  "data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                )}
              >
                <Icon />
                <span className="truncate">{item.label || "Untitled"}</span>
              </button>
            </Fragment>
          )
        })}
      </div>
    )
  }
)
