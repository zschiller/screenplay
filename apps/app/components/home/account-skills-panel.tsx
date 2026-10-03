"use client"

import { useCallback, useEffect, useState } from "react"
import { LoadErrorRow } from "@/components/home/load-error"
import { SettingsRowSkeleton } from "@/components/home/settings-row"
import { SavedSkillList } from "@/components/skills/saved-skill-list"
import {
  deleteAccountSkill,
  listAccountSkills,
  readAccountSkill,
} from "@/lib/skills/actions"
import type { OpenedSkill, SavedSkill } from "@/lib/skills/saved"

const COPY = {
  emptyDescription:
    "Ask a chat to save a skill to your account, and every chat you message can follow it.",
  deleteDescription: "Chats you message stop following it.",
}

// Account Skills are yours alone, so one a person added is one you added.
const you = () => "you"

/**
 * Settings › Skills (#1558): your Account Skills, which every chat you
 * message follows on any canvas. The same rows as Canvas settings › Skills:
 * Open shows a Skill in a dialog over Settings, and Delete confirms. To add or
 * change one, people ask a chat.
 */
export function AccountSkillsPanel({
  header,
  list = listAccountSkills,
  readSkill = readAccountSkill,
  deleteSkill = deleteAccountSkill,
}: {
  header: (action?: React.ReactNode) => React.ReactNode
  list?: () => Promise<SavedSkill[]>
  readSkill?: (name: string) => Promise<OpenedSkill>
  deleteSkill?: (name: string) => Promise<void>
}) {
  const [skills, setSkills] = useState<SavedSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    list()
      .then((listed) => {
        if (!cancelled) setSkills(listed)
      })
      .catch((err) => {
        console.error("Failed to load skills", err)
        if (!cancelled) setLoadFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [list])

  // Retry after a failed load; a second failure rejects and leaves the error up.
  const reload = useCallback(async () => {
    setSkills(await list())
    setLoadFailed(false)
  }, [list])

  return (
    <>
      {header()}
      {loading ? (
        <SettingsRowSkeleton label="Loading skills…" count={2} />
      ) : loadFailed ? (
        <LoadErrorRow title="Couldn't load skills" onRetry={reload} />
      ) : (
        <SavedSkillList
          skills={skills}
          copy={COPY}
          memberName={you}
          readSkill={readSkill}
          deleteSkill={async (name) => {
            await deleteSkill(name)
            setSkills((prev) => prev.filter((s) => s.name !== name))
          }}
        />
      )}
    </>
  )
}
