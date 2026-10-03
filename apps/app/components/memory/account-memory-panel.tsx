"use client"

import { useCallback, useEffect, useState } from "react"
import { LoadErrorRow } from "@/components/home/load-error"
import { SettingsRowSkeleton } from "@/components/home/settings-row"
import {
  addAccountMemoryEntry,
  editAccountMemoryEntry,
  listAccountMemory,
  removeAccountMemoryEntry,
} from "@/lib/memory/actions"
import type { MemoryData } from "@/lib/types"
import { MemoryEntries } from "./memory-entries"

/**
 * Settings › Memory (#1513): your account memory, which every chat you send a
 * message in reads, on any canvas. The same rows as Canvas settings › Memory,
 * with Add memory on the section's title row like New repository.
 */
export function AccountMemoryPanel({
  header,
}: {
  header: (action?: React.ReactNode) => React.ReactNode
}) {
  const [memories, setMemories] = useState<MemoryData[]>([])
  const [loading, setLoading] = useState(true)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    listAccountMemory()
      .then((list) => {
        if (!cancelled) setMemories(list)
      })
      .catch((err) => {
        console.error("Failed to load memory", err)
        if (!cancelled) setLoadFailed(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Retry after a failed load; a second failure rejects and leaves the error up.
  const reload = useCallback(async () => {
    setMemories(await listAccountMemory())
    setLoadFailed(false)
  }, [])

  // Each change returns the saved list, which replaces the shown one.
  const apply = (change: Promise<MemoryData[]>) =>
    change.then(setMemories).catch((err) => {
      console.error("Failed to save memory", err)
    })

  if (loading || loadFailed) {
    return (
      <>
        {header()}
        {loading ? (
          <SettingsRowSkeleton label="Loading memory…" count={2} />
        ) : (
          <LoadErrorRow title="Couldn't load memory" onRetry={reload} />
        )}
      </>
    )
  }

  return (
    <MemoryEntries
      memories={memories}
      header={header}
      copy={{
        emptyDescription:
          "Tell a chat how you like to work, or add a preference yourself.",
        dialogDescription: "Every chat you message reads it, on any canvas.",
        placeholder: "Write UI copy in plain sentences, no puns.",
        memberSource: "Added by you",
      }}
      onAddMemory={(text) => apply(addAccountMemoryEntry(text))}
      onEditMemory={(id, text) => apply(editAccountMemoryEntry(id, text))}
      onRemoveMemory={(id) => apply(removeAccountMemoryEntry(id))}
    />
  )
}
