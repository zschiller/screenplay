"use client"

import { forwardRef, useEffect, useImperativeHandle, useState } from "react"
import { Sparkles } from "lucide-react"

/**
 * Item shape for the `/` skill picker. `origin` is shown as a tag on each row
 * so the collaborator can tell where a Skill comes from: "App" for a bundled
 * Skill, "Repo" for one the Branch ships in its own `.claude/skills/`.
 */
export interface SkillMentionItem {
  name: string
  description: string
  origin: "app" | "repo"
}

export interface SkillMentionListHandle {
  /** Forward an editor key event into the popover; returns true if consumed. */
  onKeyDown: (event: KeyboardEvent) => boolean
}

interface SkillMentionListProps {
  items: SkillMentionItem[]
  command: (item: { id: string; label: string }) => void
  /** True while the index is still being fetched — drives the empty state. */
  loading?: boolean
}

const ORIGIN_LABEL: Record<SkillMentionItem["origin"], string> = {
  app: "App",
  repo: "Repo",
}

/**
 * Suggestion popover for the `/` skill picker. Each row shows the Skill's
 * name, an origin tag, and its description. Picking one fires `command`
 * with the Skill name as both the mention id and label so the composer
 * inserts a single atomic chip.
 */
export const SkillMentionList = forwardRef<
  SkillMentionListHandle,
  SkillMentionListProps
>(function SkillMentionList({ items, command, loading = false }, ref) {
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    // Reset highlight whenever the candidate set changes — otherwise the
    // index can land outside the array after the query narrows.
    setSelected(0)
  }, [items])

  const pick = (index: number) => {
    const item = items[index]
    if (item) command({ id: item.name, label: item.name })
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
      if (event.key === "Enter" || event.key === "Tab") {
        pick(selected)
        return true
      }
      return false
    },
  }))

  if (items.length === 0) {
    // While the per-Branch index is still loading, say so rather than "No
    // skills found" — the menu shouldn't look broken the instant it opens.
    return (
      <div className="rounded-md border border-border bg-popover px-2 py-1.5 text-xs text-muted-foreground shadow-md">
        {loading ? "Loading skills…" : "No skills found"}
      </div>
    )
  }

  return (
    <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-popover p-1 text-xs shadow-md">
      <div className="px-2 py-1 text-[10px] tracking-wide text-muted-foreground uppercase">
        Skills
      </div>
      {items.map((item, i) => (
        <button
          key={item.name}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault()
            command({ id: item.name, label: item.name })
          }}
          onMouseEnter={() => setSelected(i)}
          className={`flex w-full flex-col gap-0.5 rounded px-2 py-1.5 text-left ${
            i === selected ? "bg-accent text-accent-foreground" : ""
          }`}
        >
          <span className="flex items-center gap-2">
            <Sparkles className="h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{item.name}</span>
            <span className="ml-auto shrink-0 rounded bg-muted px-1 py-0.5 text-[9px] tracking-wide text-muted-foreground uppercase">
              {ORIGIN_LABEL[item.origin]}
            </span>
          </span>
          <span className="line-clamp-2 pl-5 text-[11px] text-muted-foreground">
            {item.description}
          </span>
        </button>
      ))}
    </div>
  )
})
