"use client"

import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { EntryScreen } from "@/components/entry/entry-screen"
import { GitHubMark } from "@/components/entry/github-mark"
import { signIn } from "@/lib/auth-client"
import { BASE_PATH } from "@/lib/base-path"

export default function SignInPage() {
  const [loading, setLoading] = useState(false)

  return (
    <EntryScreen
      description={
        <>
          Sign in with GitHub to continue. Screenplay needs access to your
          GitHub repositories so it can clone them and push commits on your
          behalf.
        </>
      }
    >
      <Button
        disabled={loading}
        onClick={async () => {
          setLoading(true)
          // Land back on the product home. Under a mount prefix that's
          // `BASE_PATH` (e.g. `/app`) — a bare "/" would resolve to the apex
          // marketing site; at root it's just "/".
          await signIn.social({
            provider: "github",
            callbackURL: BASE_PATH || "/",
          })
        }}
      >
        <GitHubMark />
        {loading ? "Redirecting…" : "Continue with GitHub"}
      </Button>
    </EntryScreen>
  )
}
