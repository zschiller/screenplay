"use client"

import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { EntryScreen } from "@/components/entry/entry-screen"
import { GitHubMark } from "@/components/entry/github-mark"
import { signIn } from "@/lib/auth-client"
import { BASE_PATH } from "@/lib/base-path"

export default function SignInPage() {
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

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
      <div className="flex flex-col items-center gap-3">
        <Button
          disabled={loading}
          onClick={async () => {
            setLoading(true)
            setFailed(false)
            // Land back on the product home. Under a mount prefix that's
            // `BASE_PATH` (e.g. `/app`) — a bare "/" would resolve to the apex
            // marketing site; at root it's just "/".
            //
            // Success navigates away, so only a failure ever returns here: the
            // client resolves with `error` for an error response and throws
            // when the request never lands. Either way the button comes back.
            try {
              const { error } = await signIn.social({
                provider: "github",
                callbackURL: BASE_PATH || "/",
              })
              if (!error) return
              console.error("Sign-in failed", error)
            } catch (err) {
              console.error("Sign-in failed", err)
            }
            setFailed(true)
            setLoading(false)
          }}
        >
          <GitHubMark />
          {loading
            ? "Redirecting…"
            : failed
              ? "Try again"
              : "Continue with GitHub"}
        </Button>
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            Couldn&rsquo;t reach GitHub to sign you in.
          </p>
        )}
      </div>
    </EntryScreen>
  )
}
