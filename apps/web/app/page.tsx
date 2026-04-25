"use client"

import { useCallback, useState } from "react"
import Link from "next/link"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@workspace/ui/components/resizable"
import { Button } from "@workspace/ui/components/button"
import { HomeProvider } from "@/components/home/home-provider"
import { HomeSidebar } from "@/components/home/home-sidebar"
import { FilesView } from "@/components/home/files-view"
import { useSession } from "@/lib/auth-client"
import {
  type PanelLayout,
  readPanelLayout,
  writePanelLayout,
} from "@/lib/panel-layout"

function HomeWorkspace() {
  const [defaultLayout] = useState<PanelLayout | undefined>(() =>
    readPanelLayout("home-layout"),
  )
  const onLayoutChanged = useCallback((layout: PanelLayout) => {
    writePanelLayout("home-layout", layout)
  }, [])

  return (
    <HomeProvider>
      <ResizablePanelGroup
        orientation="horizontal"
        className="fixed inset-0"
        defaultLayout={defaultLayout}
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

export default function Page() {
  const { data: session, isPending } = useSession()

  if (isPending) return null

  if (!session) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 py-10">
        <h1 className="text-2xl font-medium">Screenplay</h1>
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Design UI on an infinite canvas. Each artboard runs a live sandbox.
          Collaborate in real time.
        </p>
        <Button asChild>
          <Link href="/sign-in">Sign in to get started</Link>
        </Button>
      </div>
    )
  }

  return <HomeWorkspace />
}
