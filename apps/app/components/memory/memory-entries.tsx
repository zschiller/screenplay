"use client"

import { useState } from "react"
import {
  BrainIcon,
  DotsThreeIcon,
  PlusIcon,
  TrashIcon,
} from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Textarea } from "@workspace/ui/components/textarea"
import { SettingsRow, SettingsRowList } from "@/components/home/settings-row"
import { MEMORY_ENTRY_MAX_LENGTH, memorySource } from "@/lib/memory/entry"
import type { MemoryData } from "@/lib/types"

/** What differs between the account and canvas lists: their words. */
export interface MemoryCopy {
  emptyDescription: string
  /** The add and edit dialog's line on who reads the entry. */
  dialogDescription: string
  placeholder: string
  /** Who saved an entry a person added. */
  memberSource: string
}

/**
 * A memory list (#902, #1513): one row per entry with Edit and a menu holding
 * Delete, like the Repositories rows, and Add memory. Canvas settings › Memory
 * and Settings › Memory both render it; each row says whether an agent saved
 * it or a person added it.
 *
 * With `header` (a Settings section's title row), Add memory sits on the title
 * row once there are entries, as New repository does; without it, under the
 * list. Empty, the Empty state offers it either way, so it shows once.
 */
export function MemoryEntries({
  memories,
  copy,
  header,
  onAddMemory,
  onEditMemory,
  onRemoveMemory,
}: {
  memories: MemoryData[]
  copy: MemoryCopy
  header?: (action?: React.ReactNode) => React.ReactNode
  onAddMemory: (text: string) => void
  onEditMemory: (id: string, text: string) => void
  onRemoveMemory: (id: string) => void
}) {
  // `null` closed, `"new"` adding, otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const entry = memories.find((m) => m.id === editing)

  const addButton = (variant: "default" | "outline") => (
    <Button size="sm" variant={variant} onClick={() => setEditing("new")}>
      <PlusIcon />
      Add memory
    </Button>
  )

  return (
    <>
      {header?.(memories.length > 0 ? addButton("outline") : undefined)}
      {memories.length === 0 ? (
        <Empty className="flex-none border py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BrainIcon />
            </EmptyMedia>
            <EmptyTitle>No memories yet</EmptyTitle>
            <EmptyDescription>{copy.emptyDescription}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{addButton("default")}</EmptyContent>
        </Empty>
      ) : (
        <>
          <SettingsRowList>
            {memories.map((memory) => (
              <SettingsRow
                key={memory.id}
                title={memory.text}
                wrap
                detail={
                  memorySource(memory) === "agent"
                    ? "Saved by agent"
                    : copy.memberSource
                }
                action={
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={`Edit memory: ${memory.text}`}
                      onClick={() => setEditing(memory.id)}
                    >
                      Edit
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label={`More actions for memory: ${memory.text}`}
                        >
                          <DotsThreeIcon />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        onCloseAutoFocus={(event) => event.preventDefault()}
                      >
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => onRemoveMemory(memory.id)}
                        >
                          <TrashIcon />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                }
              />
            ))}
          </SettingsRowList>
          {!header && (
            <div className="flex justify-end">{addButton("default")}</div>
          )}
        </>
      )}
      <MemoryDialog
        key={editing ?? "closed"}
        open={editing !== null && (editing === "new" || entry !== undefined)}
        initialText={entry?.text ?? ""}
        isNew={editing === "new"}
        description={copy.dialogDescription}
        placeholder={copy.placeholder}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        onSave={(text) => {
          if (editing === "new") onAddMemory(text)
          else if (editing) onEditMemory(editing, text)
          setEditing(null)
        }}
      />
    </>
  )
}

/** Add or edit one entry: a textarea and Save, as a stock dialog. */
function MemoryDialog({
  open,
  initialText,
  isNew,
  description,
  placeholder,
  onOpenChange,
  onSave,
}: {
  open: boolean
  initialText: string
  isNew: boolean
  description: string
  placeholder: string
  onOpenChange: (open: boolean) => void
  onSave: (text: string) => void
}) {
  const [text, setText] = useState(initialText)
  const canSave = text.trim().length > 0 && text.trim() !== initialText
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (canSave) onSave(text)
          }}
        >
          <DialogHeader>
            <DialogTitle>{isNew ? "Add memory" : "Edit memory"}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Memory"
            value={text}
            maxLength={MEMORY_ENTRY_MAX_LENGTH}
            placeholder={placeholder}
            className="min-h-24"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                event.currentTarget.form?.requestSubmit()
              }
            }}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canSave}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
