"use client"

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from "react"
import { FileText, Frame } from "lucide-react"

export interface MentionItem {
  /** Discriminator so the popover can group docs and sketches under separate
   *  headings and propagate the kind onto the Mention node. */
  kind: "markdown-layer" | "sketch-layer"
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

const KIND_META: Record<
  MentionItem["kind"],
  { heading: string; Icon: typeof FileText }
> = {
  "markdown-layer": { heading: "Documents", Icon: FileText },
  "sketch-layer": { heading: "Sketches", Icon: Frame },
}

/**
 * Suggestion popover for the chat / document body Mention extension. Items
 * arrive as a flat list ordered Documents → Sketches; the popover groups
 * them visually under section headings while keeping selection a single
 * linear cursor (so ↑/↓ traverse the whole list, not per-section).
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

    // Walk the flat list once to figure out where each section starts.
    // Stable-ordered insert so rendering preserves the list-level index used
    // by the keyboard cursor.
    const sections = useMemo(() => {
      const out: Array<{ kind: MentionItem["kind"]; start: number; items: MentionItem[] }> = []
      let cursor = 0
      for (const item of items) {
        const last = out[out.length - 1]
        if (last && last.kind === item.kind) {
          last.items.push(item)
        } else {
          out.push({ kind: item.kind, start: cursor, items: [item] })
        }
        cursor += 1
      }
      return out
    }, [items])

    if (items.length === 0) {
      return (
        <div className="rounded-md border border-border bg-popover px-2 py-1.5 text-xs text-muted-foreground shadow-md">
          No layers found
        </div>
      )
    }

    return (
      <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-popover p-1 text-xs shadow-md">
        {sections.map((section) => {
          const { Icon, heading } = KIND_META[section.kind]
          return (
            <div key={section.kind}>
              <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {heading}
              </div>
              {section.items.map((item, i) => {
                const flatIndex = section.start + i
                return (
                  <button
                    key={item.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      command(item)
                    }}
                    onMouseEnter={() => setSelected(flatIndex)}
                    className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${
                      flatIndex === selected ? "bg-accent text-accent-foreground" : ""
                    }`}
                  >
                    <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="truncate">{item.label || "Untitled"}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    )
  },
)
