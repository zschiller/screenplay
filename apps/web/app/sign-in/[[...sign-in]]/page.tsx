"use client"

import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { signIn } from "@/lib/auth-client"

export default function SignInPage() {
  const [loading, setLoading] = useState(false)

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 py-10">
      <h1 className="text-2xl font-medium">Screenplay</h1>
      <p className="max-w-md text-center text-sm text-muted-foreground">
        Sign in with GitHub to continue. Screenplay needs repo access so it can
        clone your projects and push commits on your behalf.
      </p>
      <Button
        disabled={loading}
        onClick={async () => {
          setLoading(true)
          await signIn.social({ provider: "github", callbackURL: "/" })
        }}
      >
        {loading ? "Redirecting…" : "Continue with GitHub"}
      </Button>
    </div>
  )
}
