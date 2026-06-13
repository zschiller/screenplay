"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowUpDown, LayoutGrid, List, Plus } from "lucide-react"
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
import { useHome, type SortKey } from "./home-provider"
import { RoomGrid } from "./room-grid"
import { RoomTable } from "./room-table"
import { InputDialog } from "./input-dialog"
import { AccountMenu } from "./account-menu"

const SORT_LABELS: Record<SortKey, string> = {
  updated: "Last edited",
  created: "Date created",
  name: "Name",
}

export function RoomsView() {
  const router = useRouter()
  const { rooms, view, setView, sort, setSort, createRoom, loading } =
    useHome()
  const [newRoomOpen, setNewRoomOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  return (
    <main className="flex h-svh min-h-0 flex-col overflow-hidden bg-background">
      <header
        data-tauri-drag-region
        className="flex h-14 items-center bg-background"
      >
        <div
          data-tauri-drag-region
          className="mx-auto flex w-full max-w-6xl items-center gap-2 px-4"
        >
          <h1 className="text-base font-semibold">Canvases</h1>
          <div className="ml-auto flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <ArrowUpDown />
                  Sort: {SORT_LABELS[sort]}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
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

            <AccountMenu />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex h-64 items-center justify-center gap-2 text-muted-foreground">
            <Spinner className="size-4" />
            <span className="text-sm">Loading…</span>
          </div>
        ) : rooms.length === 0 ? (
          <EmptyState onCreate={() => setNewRoomOpen(true)} />
        ) : (
          <div className="mx-auto max-w-6xl p-4">
            {view === "grid" ? (
              <RoomGrid rooms={rooms} />
            ) : (
              <RoomTable rooms={rooms} />
            )}
          </div>
        )}
      </div>

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
            router.push(`/${room.id}`)
          } finally {
            setCreating(false)
          }
        }}
      />
    </main>
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
