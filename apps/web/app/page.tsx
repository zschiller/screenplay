"use client"

import Link from "next/link"
import {
  SidebarInset,
  SidebarProvider,
} from "@workspace/ui/components/sidebar"
import { Button } from "@workspace/ui/components/button"
import { HomeProvider } from "@/components/home/home-provider"
import { HomeSidebar } from "@/components/home/home-sidebar"
import { FilesView } from "@/components/home/files-view"
import { useSession } from "@/lib/auth-client"

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

  return (
    <HomeProvider>
      <SidebarProvider open onOpenChange={() => {}}>
        <HomeSidebar />
        <SidebarInset>
          <FilesView />
        </SidebarInset>
      </SidebarProvider>
    </HomeProvider>
  )
}
