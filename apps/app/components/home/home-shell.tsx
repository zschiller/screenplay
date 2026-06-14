"use client"

import { useCallback } from "react"
import { useParams, usePathname } from "next/navigation"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { writePanelLayout, type PanelLayout } from "@/lib/panel-layout"
import { deriveHomeScope } from "@/lib/home-scope"
import type { RoomSummary } from "@/lib/rooms-actions"
import type { FolderSummary, RoomPlacementSummary } from "@/lib/folders-actions"
import type { PinSummary } from "@/lib/pins-actions"
import { HomeProvider } from "./home-provider"
import { HomeSidebar } from "./home-sidebar"
import { FileDndProvider } from "./file-dnd"

/**
 * The two-column home frame: a drag-resizable sidebar and the scrollable
 * content panel. The sidebar width persists across reloads via the
 * `home-layout` panel cookie (seeded server-side by the group layout). Each
 * home route renders its own header + body into `children`; the sidebar is
 * persistent chrome that stays mounted across Recents / Canvases / Settings.
 *
 * The rooms/folders store lives here, not per-route (#510), so the persistent
 * sidebar and the per-route content grid read one instance. The group layout
 * server-seeds it once; the active route — not a page prop — scopes it, derived
 * from the URL below.
 */
export function HomeShell({
  children,
  initialLayout,
  initialRooms,
  initialFolders,
  initialPlacements,
  initialPins,
}: {
  children: React.ReactNode
  initialLayout?: PanelLayout
  initialRooms: RoomSummary[]
  initialFolders: FolderSummary[]
  initialPlacements: RoomPlacementSummary[]
  initialPins: PinSummary[]
}) {
  const onLayoutChanged = useCallback((layout: PanelLayout) => {
    writePanelLayout("home-layout", layout)
  }, [])

  // Per-route scoping is derived from the URL, not passed down as page props:
  // the lifted store learns which folder the content grid is showing from the
  // active route, so the route pages stay thin (title / view flags only).
  const pathname = usePathname()
  const { folderId } = useParams<{ folderId?: string }>()
  const { folderView, currentFolderId } = deriveHomeScope(pathname, folderId)

  return (
    <HomeProvider
      initialRooms={initialRooms}
      initialFolders={initialFolders}
      initialPlacements={initialPlacements}
      initialPins={initialPins}
      folderView={folderView}
      currentFolderId={currentFolderId}
    >
      {/* One DndContext spans both panels so a canvas/folder dragged in the
          content grid can drop onto a pinned folder or "All files" in the
          sidebar (and vice-versa). Mounted here, not per-route, for that reason;
          the per-tile draggables stay disabled outside folder views. */}
      <FileDndProvider>
        <ResizablePanelGroup
          orientation="horizontal"
          // `fixed inset-0` pins the frame to the viewport so both panels are
          // always full-height — a plain `h-svh` collapses to content height on
          // short pages (Canvases/Settings), leaving the sidebar short.
          className="fixed inset-0 bg-background"
          defaultLayout={initialLayout}
          onLayoutChanged={onLayoutChanged}
        >
          <ResizablePanel
            id="home-sidebar"
            defaultSize="240px"
            minSize="180px"
            maxSize="480px"
            groupResizeBehavior="preserve-pixel-size"
          >
            <HomeSidebar />
          </ResizablePanel>
          <ResizableHandle className="focus-visible:ring-0" />
          <ResizablePanel id="home-content">
            <main className="relative flex h-full w-full min-w-0 flex-col overflow-hidden bg-background">
              {children}
            </main>
          </ResizablePanel>
        </ResizablePanelGroup>
      </FileDndProvider>
    </HomeProvider>
  )
}
