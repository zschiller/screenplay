"use client"

import { useState } from "react"
import { Brain, MoreHorizontal, Plus, Trash2 } from "lucide-react"
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
import { MEMORY_ENTRY_MAX_LENGTH } from "@/lib/canvas/memory"
import type { MemoryData } from "@/lib/types"

/**
 * Canvas settings › Memory (#902): the canvas's shared memory, one row per
 * entry with Edit and a menu holding Delete, like the Repositories rows. The
 * Coordinator saves most entries; members can add, fix or remove any of them.
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
  // `null` closed, `"new"` adding, otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const entry = memories.find((m) => m.id === editing)

  const addButton = (
    <Button size="sm" onClick={() => setEditing("new")}>
      <Plus />
      Add memory
    </Button>
  )

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Preferences, decisions and facts every chat on this canvas follows. The
        Coordinator saves what it learns here.
      </p>
      {memories.length === 0 ? (
        <Empty className="flex-none border py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Brain />
            </EmptyMedia>
            <EmptyTitle>No memories yet</EmptyTitle>
            <EmptyDescription>
              Tell the Coordinator what to remember, or add a memory yourself.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>{addButton}</EmptyContent>
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
                  memory.source === "coordinator"
                    ? "Saved by the Coordinator"
                    : "Added in settings"
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
                          <MoreHorizontal />
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
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                }
              />
            ))}
          </SettingsRowList>
          <div className="flex justify-end">{addButton}</div>
        </>
      )}
      <MemoryDialog
        key={editing ?? "closed"}
        open={editing !== null && (editing === "new" || entry !== undefined)}
        initialText={entry?.text ?? ""}
        isNew={editing === "new"}
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
  onOpenChange,
  onSave,
}: {
  open: boolean
  initialText: string
  isNew: boolean
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
            <DialogDescription>
              Every chat on this canvas reads it.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            aria-label="Memory"
            value={text}
            maxLength={MEMORY_ENTRY_MAX_LENGTH}
            placeholder="Use pnpm, never npm."
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
