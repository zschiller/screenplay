"use client"

import { useAuth, SignInButton } from "@clerk/nextjs"
import {
  SidebarInset,
  SidebarProvider,
} from "@workspace/ui/components/sidebar"
import { Button } from "@workspace/ui/components/button"
import { HomeProvider } from "@/components/home/home-provider"
import { HomeSidebar } from "@/components/home/home-sidebar"
import { FilesView } from "@/components/home/files-view"

export default function Page() {
  const { isSignedIn, isLoaded } = useAuth()

  if (!isLoaded) return null

  if (!isSignedIn) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 py-10">
        <h1 className="text-2xl font-medium">Screenplay</h1>
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Design UI on an infinite canvas. Each artboard runs a live sandbox.
          Collaborate in real time.
        </p>
        <SignInButton mode="modal">
          <Button>Sign in to get started</Button>
        </SignInButton>
      </div>
    )
  }

  return (
    <HomeProvider>
      <SidebarProvider>
        <HomeSidebar />
        <SidebarInset>
          <FilesView />
        </SidebarInset>
      </SidebarProvider>
    </HomeProvider>
  )
}
