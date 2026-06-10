"use client"

import { useCallback } from "react"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { HomeProvider } from "@/components/home/home-provider"
import { HomeSidebar } from "@/components/home/home-sidebar"
import { FilesView } from "@/components/home/files-view"
import { type PanelLayout, writePanelLayout } from "@/lib/panel-layout"

export function HomeWorkspace({
  initialLayout,
}: {
  initialLayout?: PanelLayout
}) {
  const onLayoutChanged = useCallback((layout: PanelLayout) => {
    writePanelLayout("home-layout", layout)
  }, [])

  return (
    <HomeProvider>
      <ResizablePanelGroup
        orientation="horizontal"
        className="fixed inset-0"
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
          <main className="relative flex h-full w-full flex-col overflow-auto bg-background">
            <FilesView />
          </main>
        </ResizablePanel>
      </ResizablePanelGroup>
    </HomeProvider>
  )
}
