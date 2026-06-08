"use client"

import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { signIn } from "@/lib/auth-client"
import { BASE_PATH } from "@/lib/base-path"

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
          // Land back on the product home. Under a mount prefix that's
          // `BASE_PATH` (e.g. `/app`) — a bare "/" would resolve to the apex
          // marketing site; at root it's just "/".
          await signIn.social({ provider: "github", callbackURL: BASE_PATH || "/" })
        }}
      >
        {loading ? "Redirecting…" : "Continue with GitHub"}
      </Button>
    </div>
  )
}
