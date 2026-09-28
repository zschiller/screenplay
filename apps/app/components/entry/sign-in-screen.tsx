"use client"

import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { ScreenplayLogo } from "@/components/screenplay-logo"
import { GitHubMark } from "@/components/entry/github-mark"
import { signIn } from "@/lib/auth-client"
import { BASE_PATH } from "@/lib/base-path"

/**
 * The one screen a signed-out visitor meets, at `/sign-in` and on the
 * signed-out home alike: the logo, a headline and a short pitch, the GitHub
 * button, and the permissions it asks for in small print under it. Centred
 * copy is balanced with a capped measure, so no line ends on a lone word.
 */
export function SignInScreen() {
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-10">
      <div className="flex w-full max-w-[360px] flex-col items-center gap-5 text-center">
        <ScreenplayLogo className="size-11" />
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-2xl leading-tight font-semibold tracking-tight text-balance">
            Design on a canvas of your live app
          </h1>
          <p className="max-w-[34ch] text-base text-balance text-muted-foreground">
            Every frame is a running preview. Ask an agent to change it, and
            review the result together.
          </p>
        </div>
        <Button
          className="h-10 gap-2 px-4.5 text-sm"
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
        <div className="flex flex-col items-center gap-2">
          {failed && (
            <p role="alert" className="text-sm text-balance text-destructive">
              Couldn&rsquo;t reach GitHub to sign you in.
            </p>
          )}
          <p className="max-w-[36ch] text-xs text-balance text-muted-foreground">
            Screenplay clones your GitHub repositories and pushes commits on
            your behalf.
          </p>
        </div>
      </div>
    </main>
  )
}
