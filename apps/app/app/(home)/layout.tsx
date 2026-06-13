import { cookies } from "next/headers"
import Link from "next/link"
import { Button } from "@workspace/ui/components/button"
import { HomeShell } from "@/components/home/home-shell"
import { getUserId } from "@/lib/auth-helpers"
import {
  panelLayoutCookieName,
  parsePanelLayoutValue,
} from "@/lib/panel-layout"
import { listRooms } from "@/lib/rooms-actions"
import { listFolders, listRoomPlacements } from "@/lib/folders-actions"

/**
 * Shared chrome for the signed-in home surface (Recents, Canvases, Settings):
 * the left sidebar plus the scrollable content inset. Auth-gates the whole
 * group — signed-out visitors get the sign-in CTA with no sidebar instead.
 *
 * It also server-seeds the rooms/folders store once for the whole group (#510):
 * the store is lifted into the persistent home shell, so the sidebar and the
 * per-route content grid read one instance and the route pages stay thin.
 *
 * The room canvas (`/[roomId]`) lives outside this group and is unaffected.
 */
export default async function HomeLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const userId = await getUserId()

  if (!userId) {
    return <SignedOut />
  }

  // Seed the sidebar width from the persisted layout cookie so the first paint
  // matches the user's last drag — no flash from default to saved width.
  const cookieStore = await cookies()
  const initialLayout = parsePanelLayoutValue(
    cookieStore.get(panelLayoutCookieName("home-layout"))?.value
  )

  // Seed rooms, folders, and placements server-side so the grid is populated on
  // first paint — loading them client-side resolves in ~1 frame against the
  // local sidecar, which strobes an empty/loading grid when returning home from
  // a canvas. One fetch for the whole group: the lifted store is the single
  // source of truth the sidebar and the content grid share.
  const [initialRooms, initialFolders, initialPlacements] = await Promise.all([
    listRooms().catch(() => []),
    listFolders().catch(() => []),
    listRoomPlacements().catch(() => []),
  ])

  return (
    <HomeShell
      initialLayout={initialLayout}
      initialRooms={initialRooms}
      initialFolders={initialFolders}
      initialPlacements={initialPlacements}
    >
      {children}
    </HomeShell>
  )
}

function SignedOut() {
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
