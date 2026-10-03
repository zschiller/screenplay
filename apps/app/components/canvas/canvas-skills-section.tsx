"use client"

import { useCallback } from "react"
import { SavedSkillList } from "@/components/skills/saved-skill-list"
import { deleteCanvasSkill, readCanvasSkill } from "@/lib/skills/actions"
import type { SavedSkill } from "@/lib/skills/saved"

/**
 * Canvas settings › Skills (#1557): the Skills chats saved on this canvas,
 * which every chat here can follow. People read and delete them; to add or
 * change one, they ask a chat.
 */
export function CanvasSkillsSection({
  roomId,
  skills,
}: {
  roomId: string
  skills: SavedSkill[]
}) {
  const readSkill = useCallback(
    (name: string) => readCanvasSkill(roomId, name),
    [roomId]
  )
  const deleteSkill = useCallback(
    (name: string) => deleteCanvasSkill(roomId, name),
    [roomId]
  )
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Procedures every chat on this canvas can follow. To add or change one,
        ask a chat.
      </p>
      <SavedSkillList
        skills={skills}
        copy={{
          emptyDescription:
            "Ask any chat to save what it worked out as a skill.",
          deleteDescription: "Chats on this canvas stop following it.",
        }}
        readSkill={readSkill}
        deleteSkill={deleteSkill}
      />
    </>
  )
}
