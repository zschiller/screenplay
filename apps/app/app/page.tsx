import { cookies } from "next/headers"
import Link from "next/link"
import { Button } from "@workspace/ui/components/button"
import { HomeWorkspace } from "@/components/home/home-workspace"
import { getUserId } from "@/lib/auth-helpers"
import {
  panelLayoutCookieName,
  parsePanelLayoutValue,
} from "@/lib/panel-layout"

export default async function Page() {
  const userId = await getUserId()

  if (!userId) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-6 py-10">
        <h1 className="text-2xl font-medium">Screenplay</h1>
        <p className="max-w-md text-center text-sm text-muted-foreground">
          Design UI on an infinite canvas. Each iframeLayer runs a live sandbox.
          Collaborate in real time.
        </p>
        <Button asChild>
          <Link href="/sign-in">Sign in to get started</Link>
        </Button>
      </div>
    )
  }

  // Read the persisted panel layout from the cookie server-side so SSR and the
  // first client paint agree on panel sizes. Reading it on the client (e.g. via
  // `document.cookie`) would make the server render `defaultSize` while the
  // client renders the persisted layout — a hydration mismatch.
  const cookieStore = await cookies()
  const initialLayout = parsePanelLayoutValue(
    cookieStore.get(panelLayoutCookieName("home-layout"))?.value
  )

  return <HomeWorkspace initialLayout={initialLayout} />
}
