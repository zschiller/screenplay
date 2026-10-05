"use client"

import { forwardRef, useEffect, useImperativeHandle, useState } from "react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import { BookOpenIcon } from "@workspace/ui/components/icons"
import type { SkillOrigin } from "@/lib/skills/sources"

/**
 * Item shape for the `/` skill picker. `origin` names where the Skill comes
 * from, shown as a word at the end of its row (#1556).
 */
export interface SkillMentionItem {
  name: string
  description: string
  origin: SkillOrigin
  /** The coding agent's name, on its own Skills (#1560). */
  agentName?: string
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

/**
 * The word each row ends with: where its Skill lives (#1556). The desktop
 * agent's own Skills read as that agent's name, e.g. "Claude Code" (#1560),
 * and your own Account Skills read "Account" (#1558).
 */
export const SKILL_ORIGIN_LABEL: Record<SkillOrigin, string> = {
  repo: "Repository",
  canvas: "Canvas",
  account: "Account",
  agent: "Agent",
  app: "Built in",
}

/** The row's source: {@link SKILL_ORIGIN_LABEL}, or the agent's own name. */
export function skillSourceLabel(item: SkillMentionItem): string {
  return item.origin === "agent" && item.agentName
    ? item.agentName
    : SKILL_ORIGIN_LABEL[item.origin]
}

/**
 * Suggestion popover for the `/` skill picker. Each row shows the Skill's
 * name, where it comes from, and its description. Picking one fires `command`
 * with the Skill name as both the mention id and label so the composer
 * inserts a single atomic chip.
 *
 * Typing stays in the composer, so the highlight is driven from the editor's
 * key events ({@link SkillMentionListHandle}) and the Command only draws it.
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

  return (
    <Command
      shouldFilter={false}
      label="Skills"
      value={items[selected]?.name ?? ""}
      onValueChange={(name) => {
        const i = items.findIndex((s) => s.name === name)
        if (i >= 0) setSelected(i)
      }}
      className="rounded-lg! shadow-md ring-1 ring-foreground/10"
    >
      <CommandList>
        {/* While the per-Branch index is still loading, say so rather than
            "No skills found": the menu shouldn't look broken the instant it
            opens. */}
        <CommandEmpty>
          {loading ? "Loading skills…" : "No skills found"}
        </CommandEmpty>
        {items.length > 0 && (
          <CommandGroup heading="Skills">
            {items.map((item) => (
              <CommandItem
                key={item.name}
                value={item.name}
                // Keep the composer focused: the chip goes in where the caret is.
                onMouseDown={(e) => e.preventDefault()}
                onSelect={() => command({ id: item.name, label: item.name })}
                className="flex-col items-stretch gap-0.5"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <BookOpenIcon className="text-muted-foreground" />
                  <span className="truncate font-medium">{item.name}</span>
                  <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                    {skillSourceLabel(item)}
                  </span>
                </span>
                <span className="line-clamp-2 pl-6 text-xs text-muted-foreground">
                  {item.description}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
    </Command>
  )
})
