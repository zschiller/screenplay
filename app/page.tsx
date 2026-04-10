"use client"

import { useRouter } from "next/navigation"
import { nanoid } from "nanoid"
import { useAuth, SignInButton, UserButton } from "@clerk/nextjs"
import { Button } from "@/components/ui/button"

export default function Page() {
  const router = useRouter()
  const { isSignedIn, isLoaded } = useAuth()

  const handleCreateRoom = () => {
    const roomId = nanoid(10)
    router.push(`/${roomId}`)
  }

  if (!isLoaded) return null

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6">
      <h1 className="text-2xl font-medium">Screenplay</h1>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        Design UI on an infinite canvas. Each artboard runs a live sandbox.
        Collaborate in real time.
      </p>

      {isSignedIn ? (
        <div className="flex items-center gap-4">
          <Button onClick={handleCreateRoom}>Create Room</Button>
          <UserButton />
        </div>
      ) : (
        <SignInButton mode="modal">
          <Button>Sign in to get started</Button>
        </SignInButton>
      )}
    </div>
  )
}
