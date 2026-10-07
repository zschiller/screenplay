"use client"

import { useState } from "react"
import {
  FolderOpenIcon,
  FolderPlusIcon,
  FunnelSimpleIcon,
  ListBulletsIcon,
  PlusIcon,
  SquaresFourIcon,
} from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import { HomeScrollBody } from "./home-scroll-body"
import {
  HOME_COLUMN,
  HomePageHeader,
  HomeToolbarLabel,
  HomeToolbarTooltip,
} from "./home-page-header"
import { useHome, type OwnerFilter } from "./home-provider"
import { RoomGrid } from "./room-grid"
import { RoomTable } from "./room-table"
import { FolderGrid } from "./folder-grid"
import { FolderBreadcrumb } from "./folder-breadcrumb"
import { InputDialog } from "./input-dialog"
import { NEW_CANVAS_SHORTCUT, useNewCanvasShortcut } from "./use-create-canvas"
import { LoadErrorState } from "./load-error"
import { buildIdentity } from "@/lib/capabilities"
import { CanvasIcon } from "@/components/canvas-icon"
import type { RoomSummary } from "@/lib/rooms-actions"
import type { FolderSummary } from "@/lib/folders-actions"

const OWNER_LABELS: Record<OwnerFilter, string> = {
  all: "Anyone",
  mine: "Owned by me",
  shared: "Shared with me",
}

/**
 * The canvas list with New canvas and the grid/table toggle. There's no sort
 * menu: the table's column headers set the order, and the grid keeps whatever
 * the table last picked for this surface (last edited until then).
 * `showFolders` adds the folder section + "New folder" button — on for All
 * files, off for Recents, which stays a flat cross-folder recency view
 * (PRD #475).
 */
export function RoomsView({
  title,
  showFolders = false,
}: {
  title: string
  showFolders?: boolean
}) {
  const {
    rooms,
    folders,
    folderView,
    currentFolderId,
    ancestors,
    view,
    setView,
    createFolder,
    openNewCanvas,
    loading,
    loadFailed,
    reload,
    search,
  } = useHome()
  // The ownership filter is this page's own, so leaving the page (say, into a
  // result's folder) resets it. Typed search lives in the sidebar's popover
  // and never replaces the page.
  const [owner, setOwner] = useState<OwnerFilter>("all")
  const results = owner !== "all" ? search("", owner) : null
  // New canvas asks for a name and Repositories first (#1812).
  const newCanvas = () => openNewCanvas()
  useNewCanvasShortcut(newCanvas)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)

  const header = (
    <HomePageHeader
      // All files / a folder reads as a breadcrumb trail; Recents keeps its
      // plain title.
      title={folderView ? <FolderBreadcrumb ancestors={ancestors} /> : title}
      actions={
        <>
          {/* Sharing doesn't exist in the single-user desktop build, where
              every Canvas is the user's own. */}
          {buildIdentity === "account" && (
            <DropdownMenu>
              <HomeToolbarTooltip label={`Owner: ${OWNER_LABELS[owner]}`}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    aria-label={`Owner: ${OWNER_LABELS[owner]}`}
                  >
                    <FunnelSimpleIcon />
                    <HomeToolbarLabel>{OWNER_LABELS[owner]}</HomeToolbarLabel>
                  </Button>
                </DropdownMenuTrigger>
              </HomeToolbarTooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuRadioGroup
                  value={owner}
                  onValueChange={(v) => setOwner(v as OwnerFilter)}
                >
                  <DropdownMenuRadioItem value="all">
                    Anyone
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="mine">
                    Owned by me
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="shared">
                    Shared with me
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {showFolders && (
            <HomeToolbarTooltip label="New folder">
              <Button
                variant="outline"
                aria-label="New folder"
                onClick={() => setNewFolderOpen(true)}
              >
                <FolderPlusIcon />
                <HomeToolbarLabel>New folder</HomeToolbarLabel>
              </Button>
            </HomeToolbarTooltip>
          )}

          <HomeToolbarTooltip label="New canvas" shortcut={NEW_CANVAS_SHORTCUT}>
            <Button aria-label="New canvas" onClick={newCanvas}>
              <PlusIcon />
              <HomeToolbarLabel>New canvas</HomeToolbarLabel>
            </Button>
          </HomeToolbarTooltip>

          <Tabs
            value={view}
            onValueChange={(v) => {
              if (v === "grid" || v === "table") setView(v)
            }}
          >
            <TabsList>
              <TabsTrigger value="grid" aria-label="Grid view">
                <SquaresFourIcon />
              </TabsTrigger>
              <TabsTrigger value="table" aria-label="Table view">
                <ListBulletsIcon />
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </>
      }
    />
  )

  return (
    <>
      <HomeScrollBody header={header}>
        {loading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="size-4" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : loadFailed ? (
          <LoadErrorState
            title="Couldn’t load your canvases"
            description="Something went wrong while loading them."
            onRetry={reload}
          />
        ) : results ? (
          <FilterResults
            rooms={results.rooms}
            folders={results.folders}
            view={view}
            onClear={() => setOwner("all")}
          />
        ) : rooms.length === 0 && folders.length === 0 ? (
          // A nested folder with nothing in it reads as "empty", not first-run.
          folderView && currentFolderId !== null ? (
            <EmptyState
              icon={<FolderOpenIcon />}
              title="This folder is empty"
              description="Create a folder or a canvas to fill it."
              onCreate={newCanvas}
            />
          ) : (
            <EmptyState onCreate={newCanvas} />
          )
        ) : (
          <div className={cn(HOME_COLUMN, "pb-4")}>
            {/* Drag-drop filing rides the one DndContext mounted at the shell
                (HomeShell), so a canvas or folder can be dragged onto a folder
                tile here — or onto a pinned folder / "All files" in the sidebar
                (issue #487). The per-tile draggables stay disabled outside folder
                views, so Recents stays a plain list with nothing to pick up. */}
            {view === "grid" ? (
              <div className="space-y-4">
                {/* Folders render in their own section above the files. */}
                {showFolders && folders.length > 0 && (
                  <FolderGrid folders={folders} />
                )}
                <RoomGrid rooms={rooms} />
              </div>
            ) : (
              // The table cells carry their own `p-3` padding, indenting the
              // Name column 12px past the header title above. Pull the table out
              // by that padding so its leading text lines up with the title.
              <div className="-mx-3">
                <RoomTable rooms={rooms} folders={showFolders ? folders : []} />
              </div>
            )}
          </div>
        )}
      </HomeScrollBody>

      {showFolders && (
        <InputDialog
          open={newFolderOpen}
          onOpenChange={(open) => {
            if (!creatingFolder) setNewFolderOpen(open)
          }}
          title="New folder"
          errorMessage="Couldn’t create the folder. Try again."
          placeholder="Untitled folder"
          submitLabel={creatingFolder ? "Creating…" : "Create"}
          submittingLabel="Creating…"
          onSubmit={async (name) => {
            setCreatingFolder(true)
            try {
              // Nests under the folder you're viewing (the provider derives the
              // parent from the current folder).
              await createFolder(name)
            } finally {
              setCreatingFolder(false)
            }
          }}
        />
      )}
    </>
  )
}

/**
 * Library-wide results for the ownership filter (#807), in the same grid or
 * table as the folder view, with each result naming where it lives.
 */
function FilterResults({
  rooms,
  folders,
  view,
  onClear,
}: {
  rooms: RoomSummary[]
  folders: FolderSummary[]
  view: "grid" | "table"
  onClear: () => void
}) {
  const count = rooms.length + folders.length
  if (count === 0) {
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FunnelSimpleIcon />
          </EmptyMedia>
          <EmptyTitle>No matches</EmptyTitle>
          <EmptyDescription>
            No canvas in any folder matches this filter.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={onClear}>
            Clear filter
          </Button>
        </EmptyContent>
      </Empty>
    )
  }
  return (
    <div className={cn(HOME_COLUMN, "pb-4")}>
      <p role="status" className="mb-3 text-xs text-muted-foreground">
        {count === 1 ? "1 result" : `${count} results`} across all folders
      </p>
      {view === "grid" ? (
        <div className="space-y-4">
          {folders.length > 0 && <FolderGrid folders={folders} showLocation />}
          <RoomGrid rooms={rooms} showLocation />
        </div>
      ) : (
        <div className="-mx-3">
          <RoomTable rooms={rooms} folders={folders} showLocation />
        </div>
      )}
    </div>
  )
}

function EmptyState({
  onCreate,
  icon = <CanvasIcon />,
  title = "Create your first canvas",
  description = "A canvas is your space to design with live previews.",
}: {
  onCreate: () => void
  icon?: React.ReactNode
  title?: string
  description?: string
}) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button size="sm" onClick={onCreate}>
          <PlusIcon />
          New canvas
        </Button>
      </EmptyContent>
    </Empty>
  )
}
