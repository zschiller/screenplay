"use client"

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
} from "react"
import { FileText } from "lucide-react"

export interface MentionItem {
  id: string
  label: string
}

export interface MentionListHandle {
  /** Forward an editor key event into the popover; returns true if consumed. */
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface MentionListProps {
  items: MentionItem[]
  command: (item: MentionItem) => void
}

/**
 * Suggestion popover for the agent chat's TipTap mention extension. The
 * editor's `suggestion.render()` mounts this and forwards arrow / enter /
 * escape keystrokes through the imperative handle, mirroring TipTap's
 * recommended pattern but rendered with our own Tailwind styling instead of
 * tippy.js (which the rest of the app doesn't use).
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
        <div className="rounded-md border border-border bg-popover px-2 py-1.5 text-xs text-muted-foreground shadow-md">
          No documents found
        </div>
      )
    }

    return (
      <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-popover p-1 text-xs shadow-md">
        <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Documents
        </div>
        {items.map((item, i) => (
          <button
            key={item.id}
            type="button"
            onMouseDown={(e) => {
              e.preventDefault()
              command(item)
            }}
            onMouseEnter={() => setSelected(i)}
            className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
              i === selected ? "bg-accent text-accent-foreground" : ""
            }`}
          >
            <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate">{item.label || "Untitled"}</span>
          </button>
        ))}
      </div>
    )
  },
)
