"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowUpDown,
  LayoutGrid,
  List,
  Pin,
  Plus,
} from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Separator } from "@workspace/ui/components/separator"
import { SidebarTrigger } from "@workspace/ui/components/sidebar"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Spinner } from "@workspace/ui/components/spinner"
import { DRAFTS_FOLDER_ID } from "@/lib/organization-actions"
import {
  ALL_VIEW_ID,
  PINNED_VIEW_ID,
  useHome,
  type SortKey,
} from "./home-provider"
import { FileGrid } from "./file-grid"
import { FileTable } from "./file-table"
import { InputDialog } from "./file-dialogs"

const SORT_LABELS: Record<SortKey, string> = {
  updated: "Last edited",
  created: "Date created",
  name: "Name",
}

export function FilesView() {
  const router = useRouter()
  const {
    filesInSelection,
    selectedId,
    selectionLabel,
    view,
    setView,
    sort,
    setSort,
    createFile,
    loading,
  } = useHome()
  const [newFileOpen, setNewFileOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  const newFileFolderId =
    selectedId === PINNED_VIEW_ID || selectedId === ALL_VIEW_ID
      ? DRAFTS_FOLDER_ID
      : selectedId

  const canCreateHere =
    selectedId !== PINNED_VIEW_ID && selectedId !== ALL_VIEW_ID

  return (
    <div className="flex h-svh min-h-0 flex-1 flex-col">
      <header className="flex h-14 items-center gap-2 border-b border-border bg-background px-4">
        <SidebarTrigger />
        <Separator orientation="vertical" className="h-5" />
        <div className="flex items-center gap-2">
          {selectedId === PINNED_VIEW_ID && <Pin className="size-4" />}
          <h1 className="text-base font-semibold">{selectionLabel}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <ArrowUpDown />
                Sort: {SORT_LABELS[sort]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={(v) => setSort(v as SortKey)}
              >
                <DropdownMenuRadioItem value="updated">
                  Last edited
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="created">
                  Date created
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="name">
                  Name
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => {
              if (v === "grid" || v === "table") setView(v)
            }}
            size="sm"
          >
            <ToggleGroupItem value="grid" aria-label="Grid view">
              <LayoutGrid />
            </ToggleGroupItem>
            <ToggleGroupItem value="table" aria-label="Table view">
              <List />
            </ToggleGroupItem>
          </ToggleGroup>

          <Button
            size="sm"
            onClick={() => setNewFileOpen(true)}
            disabled={!canCreateHere}
            title={
              canCreateHere
                ? "Create a new file"
                : "Select a folder to create a file"
            }
          >
            <Plus />
            New file
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="size-4" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : filesInSelection.length === 0 ? (
          <EmptyState
            selectionLabel={selectionLabel}
            canCreate={canCreateHere}
            onCreate={() => setNewFileOpen(true)}
          />
        ) : (
          <div className="p-4">
            {view === "grid" ? (
              <FileGrid files={filesInSelection} />
            ) : (
              <FileTable files={filesInSelection} />
            )}
          </div>
        )}
      </div>

      <InputDialog
        open={newFileOpen}
        onOpenChange={(open) => {
          if (!creating) setNewFileOpen(open)
        }}
        title="New file"
        description={
          newFileFolderId === DRAFTS_FOLDER_ID
            ? "This file will be added to Drafts. You can move it later."
            : `This file will be added to "${selectionLabel}".`
        }
        placeholder="Untitled"
        submitLabel={creating ? "Creating…" : "Create"}
        submittingLabel="Creating…"
        onSubmit={async (name) => {
          setCreating(true)
          try {
            const file = await createFile(name, newFileFolderId)
            router.push(`/${file.id}`)
          } finally {
            setCreating(false)
          }
        }}
      />
    </div>
  )
}

function EmptyState({
  selectionLabel,
  canCreate,
  onCreate,
}: {
  selectionLabel: string
  canCreate: boolean
  onCreate: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <LayoutGrid className="size-5" />
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Nothing in {selectionLabel}</h2>
        <p className="text-sm text-muted-foreground">
          {canCreate
            ? "Create a new file to get started."
            : "Files you add to folders will appear here."}
        </p>
      </div>
      {canCreate && (
        <Button size="sm" onClick={onCreate}>
          <Plus />
          New file
        </Button>
      )}
    </div>
  )
}
