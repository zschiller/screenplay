"use client"

import { MemoryEntries } from "@/components/memory/memory-entries"
import type { MemoryData } from "@/lib/types"

/**
 * Canvas settings › Memory (#902): the canvas's shared memory. Every chat on
 * the canvas saves entries (#1515); members can add, fix or remove any of them.
 */
export function MemorySection({
  memories,
  onAddMemory,
  onEditMemory,
  onRemoveMemory,
}: {
  memories: MemoryData[]
  onAddMemory: (text: string) => void
  onEditMemory: (id: string, text: string) => void
  onRemoveMemory: (id: string) => void
}) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Preferences, decisions and facts every chat on this canvas follows.
        Chats save what they learn here.
      </p>
      <MemoryEntries
        memories={memories}
        copy={{
          emptyDescription:
            "Tell a chat what to remember, or add a memory yourself.",
          dialogDescription: "Every chat on this canvas reads it.",
          placeholder: "Use pnpm, never npm.",
          memberSource: "Added in settings",
        }}
        onAddMemory={onAddMemory}
        onEditMemory={onEditMemory}
        onRemoveMemory={onRemoveMemory}
      />
    </>
  )
}
