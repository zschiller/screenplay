"use client"

import { useCallback } from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { writePanelLayout, type PanelLayout } from "@/lib/panel-layout"
import { HomeSidebar } from "./home-sidebar"

/**
 * The two-column home frame: a drag-resizable sidebar and the scrollable
 * content panel. The sidebar width persists across reloads via the
 * `home-layout` panel cookie (seeded server-side by the group layout). Each
 * home route renders its own header + body into `children`; the sidebar is
 * persistent chrome that stays mounted across Recents / Canvases / Settings.
 */
export function HomeShell({
  children,
  initialLayout,
}: {
  children: React.ReactNode
  initialLayout?: PanelLayout
}) {
  const onLayoutChanged = useCallback((layout: PanelLayout) => {
    writePanelLayout("home-layout", layout)
  }, [])

  return (
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
  )
}
