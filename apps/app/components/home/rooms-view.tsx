"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import {
  ArrowDown,
  ArrowUp,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  List,
  ListFilter,
  Plus,
  Search,
} from "lucide-react"
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
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
import {
  useHome,
  defaultOrder,
  type OwnerFilter,
  type SortKey,
  type SortOrder,
} from "./home-provider"
import { RoomGrid } from "./room-grid"
import { RoomTable } from "./room-table"
import { FolderGrid } from "./folder-grid"
import { FolderBreadcrumb } from "./folder-breadcrumb"
import { InputDialog } from "./input-dialog"
import { LoadErrorState } from "./load-error"
import { HomeSearchField } from "./home-search-field"
import { isSearching } from "@/lib/home-search"
import { isLocalBuild } from "@/lib/local-mode"
import { prewarmRoom } from "@/lib/yjs-host/client"
import { CanvasIcon } from "@/components/canvas-icon"
import type { RoomSummary } from "@/lib/rooms-actions"
import type { FolderSummary } from "@/lib/folders-actions"

const SORT_LABELS: Record<SortKey, string> = {
  updated: "Last edited",
  created: "Date created",
  name: "Name",
}

// Order labels read naturally per sort key: names go A→Z, timestamps go by
// recency.
const ORDER_LABELS: Record<SortKey, Record<SortOrder, string>> = {
  updated: { desc: "Newest first", asc: "Oldest first" },
  created: { desc: "Newest first", asc: "Oldest first" },
  name: { asc: "A to Z", desc: "Z to A" },
}

const OWNER_LABELS: Record<OwnerFilter, string> = {
  all: "Anyone",
  mine: "Owned by me",
  shared: "Shared with me",
}

/**
 * The canvas list with grid/table toggle and New canvas. `showSort` exposes the
 * sort dropdown (Canvases); Recents omits it and rides the provider's default
 * last-edited order so it's always recency-first. `showFolders` adds the folder
 * section + "Add folder" button — on for All files, off for Recents, which
 * stays a flat cross-folder recency view (PRD #475).
 */
export function RoomsView({
  title,
  showSort = true,
  showFolders = false,
}: {
  title: string
  showSort?: boolean
  showFolders?: boolean
}) {
  const router = useRouter()
  const {
    rooms,
    folders,
    folderView,
    currentFolderId,
    ancestors,
    view,
    setView,
    sort,
    setSort,
    order,
    setOrder,
    createRoom,
    createFolder,
    loading,
    loadFailed,
    reload,
    search,
  } = useHome()
  // Search and the ownership filter are per visit: they span every folder,
  // so leaving the page (say, into a result's folder) starts it fresh.
  const [query, setQuery] = useState("")
  const [owner, setOwner] = useState<OwnerFilter>("all")
  const results = isSearching(query, owner) ? search(query, owner) : null
  const [newRoomOpen, setNewRoomOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)

  // The down arrow always marks each key's default order, which is also the
  // first item in the Order menu — so every sort key reads the same way
  // regardless of whether its default happens to be ascending or descending.
  const primaryOrder = defaultOrder(sort)
  const reversedOrder: SortOrder = primaryOrder === "asc" ? "desc" : "asc"
  const isDefaultOrder = order === primaryOrder

  const sortLabel = `Sort: ${SORT_LABELS[sort]}, ${ORDER_LABELS[sort][order].toLowerCase()}`

  const header = (
    <HomePageHeader
      // All files / a folder reads as a breadcrumb trail; Recents keeps its
      // plain title.
      title={folderView ? <FolderBreadcrumb ancestors={ancestors} /> : title}
      search={<HomeSearchField value={query} onChange={setQuery} />}
      actions={
        <>
          {/* Sharing doesn't exist in the single-user desktop build, where
              every Canvas is the user's own. */}
          {!isLocalBuild && (
            <DropdownMenu>
              <HomeToolbarTooltip label={`Owner: ${OWNER_LABELS[owner]}`}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    aria-label={`Owner: ${OWNER_LABELS[owner]}`}
                  >
                    <ListFilter />
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

          {showSort && (
            <DropdownMenu>
              <HomeToolbarTooltip label={sortLabel}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" aria-label={sortLabel}>
                    {isDefaultOrder ? <ArrowDown /> : <ArrowUp />}
                    <HomeToolbarLabel>{SORT_LABELS[sort]}</HomeToolbarLabel>
                  </Button>
                </DropdownMenuTrigger>
              </HomeToolbarTooltip>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
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
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Order</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={order}
                  onValueChange={(v) => setOrder(v as SortOrder)}
                >
                  <DropdownMenuRadioItem value={primaryOrder}>
                    {ORDER_LABELS[sort][primaryOrder]}
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value={reversedOrder}>
                    {ORDER_LABELS[sort][reversedOrder]}
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Tabs
            value={view}
            onValueChange={(v) => {
              if (v === "grid" || v === "table") setView(v)
            }}
          >
            <TabsList>
              <TabsTrigger value="grid" aria-label="Grid view">
                <LayoutGrid />
              </TabsTrigger>
              <TabsTrigger value="table" aria-label="Table view">
                <List />
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {showFolders && (
            <HomeToolbarTooltip label="Add folder">
              <Button
                variant="outline"
                aria-label="Add folder"
                onClick={() => setNewFolderOpen(true)}
              >
                <FolderPlus />
                <HomeToolbarLabel>Add folder</HomeToolbarLabel>
              </Button>
            </HomeToolbarTooltip>
          )}

          <HomeToolbarTooltip label="New canvas">
            <Button
              aria-label="New canvas"
              onClick={() => setNewRoomOpen(true)}
            >
              <Plus />
              <HomeToolbarLabel>New canvas</HomeToolbarLabel>
            </Button>
          </HomeToolbarTooltip>
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
            title="Couldn't load your canvases"
            description="Something went wrong while loading them."
            onRetry={reload}
          />
        ) : results ? (
          <SearchResults
            rooms={results.rooms}
            folders={results.folders}
            view={view}
            onClear={() => {
              setQuery("")
              setOwner("all")
            }}
          />
        ) : rooms.length === 0 && folders.length === 0 ? (
          // A nested folder with nothing in it reads as "empty", not first-run.
          folderView && currentFolderId !== null ? (
            <EmptyState
              icon={<FolderOpen />}
              title="This folder is empty"
              description="Add a folder or a canvas to fill it."
              onCreate={() => setNewRoomOpen(true)}
            />
          ) : (
            <EmptyState onCreate={() => setNewRoomOpen(true)} />
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

      <InputDialog
        open={newRoomOpen}
        onOpenChange={(open) => {
          if (!creating) setNewRoomOpen(open)
        }}
        title="New canvas"
        errorMessage="Couldn't create the canvas. Try again."
        placeholder="Untitled"
        submitLabel={creating ? "Creating…" : "Create"}
        submittingLabel="Creating…"
        onSubmit={async (name) => {
          setCreating(true)
          try {
            const room = await createRoom(name)
            // Open the connection before navigating so the new canvas renders
            // synced on its first frame rather than flashing the sync gate.
            prewarmRoom(room.id)
            router.push(`/${room.id}`)
          } finally {
            setCreating(false)
          }
        }}
      />

      {showFolders && (
        <InputDialog
          open={newFolderOpen}
          onOpenChange={(open) => {
            if (!creatingFolder) setNewFolderOpen(open)
          }}
          title="New folder"
          errorMessage="Couldn't create the folder. Try again."
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
 * Library-wide results for a search or ownership filter (#807), in the same
 * grid or table as the folder view, with each result naming where it lives.
 */
function SearchResults({
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
            <Search />
          </EmptyMedia>
          <EmptyTitle>No matches</EmptyTitle>
          <EmptyDescription>Nothing in any folder matches.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button size="sm" variant="outline" onClick={onClear}>
            Clear search
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
          <Plus />
          New canvas
        </Button>
      </EmptyContent>
    </Empty>
  )
}
