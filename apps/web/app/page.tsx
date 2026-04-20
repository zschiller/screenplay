"use client"

import { useState } from "react"
import { useAuth, SignInButton, UserButton } from "@clerk/nextjs"
import { Button } from "@workspace/ui/components/button"
import { WorkspaceConfigsDialog } from "@/components/home/workspace-configs-dialog"
import { ProjectsList } from "@/components/home/projects-list"

export default function Page() {
  const { isSignedIn, isLoaded } = useAuth()
  const [configsOpen, setConfigsOpen] = useState(false)

  if (!isLoaded) return null

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 py-10">
      <h1 className="text-2xl font-medium">Screenplay</h1>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        Design UI on an infinite canvas. Each artboard runs a live sandbox.
        Collaborate in real time.
      </p>

      {isSignedIn ? (
        <>
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={() => setConfigsOpen(true)}>
              Configured Repositories
            </Button>
            <UserButton />
            <WorkspaceConfigsDialog
              open={configsOpen}
              onOpenChange={setConfigsOpen}
            />
          </div>
          <ProjectsList />
        </>
      ) : (
        <SignInButton mode="modal">
          <Button>Sign in to get started</Button>
        </SignInButton>
      )}
    </div>
  )
}
