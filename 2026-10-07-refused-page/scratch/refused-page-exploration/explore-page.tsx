// SCRATCH, never committed: the refused-page exploration's options.
import { ArrowSquareOutIcon, EyeSlashIcon } from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"

import { CanvasRouteState } from "@/components/canvas/canvas-route-state"
import { RefusedScreen } from "@/components/viewer/refused-screen"
import { ScreenplayLogo } from "@/components/screenplay-logo"

const MESSAGE = "Open this link through the dev-box proxy to sign in."
const URL_ = "https://sso.corp.example/login"

export default async function Explore({
  searchParams,
}: {
  searchParams: Promise<{ o?: string; link?: string }>
}) {
  const { o = "A", link = "1" } = await searchParams
  const signInUrl = link === "1" ? URL_ : undefined
  if (o === "A") return <RefusedScreen message={MESSAGE} signInUrl={signInUrl} />
  if (o === "B")
    return (
      <CanvasRouteState
        icon={<EyeSlashIcon />}
        title={"" as string}
        description={MESSAGE}
        className="[&_[data-slot=empty-title]]:hidden [&_[data-slot=empty-description]]:text-foreground"
      >
        {signInUrl && (
          <Button size="sm" asChild>
            <a href={signInUrl}>
              sso.corp.example
              <ArrowSquareOutIcon />
            </a>
          </Button>
        )}
      </CanvasRouteState>
    )
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-background px-6 py-10">
      <div className="flex w-full max-w-[400px] flex-col items-center gap-5 text-center">
        <ScreenplayLogo className="size-11" />
        <h1 className="font-heading text-title-lg text-balance">{MESSAGE}</h1>
        {signInUrl && (
          <Button size="sm" asChild>
            <a href={signInUrl}>Sign in</a>
          </Button>
        )}
      </div>
    </main>
  )
}
