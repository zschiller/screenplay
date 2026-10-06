"use client"

import { createContext, useContext, type ReactNode } from "react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card"
import { skillSourceLabel } from "@/components/agent/skill-mention-list"
import { WORKSPACE_HOVER_CARD_DELAY_MS } from "@/components/workspace-hover-card"
import type { SkillMenuItem } from "@/lib/skills-store"

/** The Skills the chat reads, the same index its `/` menu lists. */
export const SkillIndexContext = createContext<readonly SkillMenuItem[]>([])

/**
 * The hover card on a `/`-Skill a message names: its name, where it comes
 * from and its description, after the same pause as the other mention cards.
 * A Skill the chat doesn't read (renamed, or a chat with no Skills) keeps the
 * bare mention.
 */
export function SkillHoverCard({
  name,
  children,
}: {
  name: string
  children: ReactNode
}) {
  const skills = useContext(SkillIndexContext)
  const skill = skills.find((s) => s.name === name)
  if (!skill) return <>{children}</>
  return (
    <HoverCard openDelay={WORKSPACE_HOVER_CARD_DELAY_MS}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent side="bottom" align="start" className="w-64">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-medium break-words">/{skill.name}</p>
          <p className="text-sm text-muted-foreground">
            {skillSourceLabel(skill)} skill
          </p>
        </div>
        {skill.description && (
          <p className="text-sm break-words">{skill.description}</p>
        )}
      </HoverCardContent>
    </HoverCard>
  )
}
