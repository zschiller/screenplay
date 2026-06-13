"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowDown, ArrowUp, LayoutGrid, List, Plus } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
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
import { HomeScrollBody } from "./home-scroll-body"
import {
  useHome,
  defaultOrder,
  type SortKey,
  type SortOrder,
} from "./home-provider"
import { RoomGrid } from "./room-grid"
import { RoomTable } from "./room-table"
import { InputDialog } from "./input-dialog"
import { prewarmRoom } from "@/lib/yjs-host/client"

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

/**
 * The canvas list with grid/table toggle and New canvas. `showSort` exposes the
 * sort dropdown (Canvases); Recents omits it and rides the provider's default
 * last-edited order so it's always recency-first.
 */
export function RoomsView({
  title,
  showSort = true,
}: {
  title: string
  showSort?: boolean
}) {
  const router = useRouter()
  const {
    rooms,
    view,
    setView,
    sort,
    setSort,
    order,
    setOrder,
    createRoom,
    loading,
  } = useHome()
  const [newRoomOpen, setNewRoomOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  // The down arrow always marks each key's default order, which is also the
  // first item in the Order menu — so every sort key reads the same way
  // regardless of whether its default happens to be ascending or descending.
  const primaryOrder = defaultOrder(sort)
  const reversedOrder: SortOrder = primaryOrder === "asc" ? "desc" : "asc"
  const isDefaultOrder = order === primaryOrder

  const header = (
    <header
      data-tauri-drag-region
      className="flex h-14 items-center bg-background"
    >
      <div
        data-tauri-drag-region
        className="mx-auto flex w-full max-w-5xl items-center gap-2 px-16"
      >
          <h1 className="text-2xl font-normal">{title}</h1>
          <div className="ml-auto flex items-center gap-2">
            {showSort && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    {isDefaultOrder ? <ArrowDown /> : <ArrowUp />}
                    {SORT_LABELS[sort]}
                  </Button>
                </DropdownMenuTrigger>
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

            <Button onClick={() => setNewRoomOpen(true)}>
              <Plus />
              New canvas
            </Button>
          </div>
        </div>
    </header>
  )

  return (
    <>
      <HomeScrollBody header={header}>
        {loading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="size-4" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : rooms.length === 0 ? (
          <EmptyState onCreate={() => setNewRoomOpen(true)} />
        ) : (
          <div className="mx-auto max-w-5xl px-16 pb-4">
            {view === "grid" ? (
              <RoomGrid rooms={rooms} />
            ) : (
              <RoomTable rooms={rooms} />
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
    </>
  )
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <LayoutGrid className="size-5" />
      </div>
      <div className="space-y-1">
        <h2 className="text-sm font-medium">Create your first canvas</h2>
        <p className="text-sm text-muted-foreground">
          A canvas is your space to design with live previews.
        </p>
      </div>
      <Button size="sm" onClick={onCreate}>
        <Plus />
        New canvas
      </Button>
    </div>
  )
}
