import { cookies } from "next/headers"
import { SignInScreen } from "@/components/entry/sign-in-screen"
import { HomeShell } from "@/components/home/home-shell"
import { getUserId } from "@/lib/auth-helpers"
import { readFixtureEntryState } from "@/lib/fixture-entry"
import { hasFixtureFault } from "@/lib/fixture-faults"
import {
  panelLayoutCookieName,
  parsePanelLayoutValue,
} from "@/lib/panel-layout"
import {
  homeViewPrefsCookieName,
  parseHomeViewPrefs,
} from "@/lib/home-view-prefs"
import { listRooms } from "@/lib/rooms-actions"
import { listFolders, listRoomPlacements } from "@/lib/folders-actions"
import { listPins } from "@/lib/pins-actions"

/**
 * Shared chrome for the signed-in home surface (Recents, Canvases, Settings):
 * the left sidebar plus the scrollable content inset. Auth-gates the whole
 * group — signed-out visitors get the sign-in screen itself, with no sidebar
 * and no intermediate landing page.
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

  // The local build is always signed in, so a screenshot capture asks for the
  // signed-out surface explicitly (a no-op outside the Fixture World).
  if (!userId || (await readFixtureEntryState()) === "signed-out") {
    return <SignInScreen />
  }

  // Seed the sidebar width from the persisted layout cookie so the first paint
  // matches the user's last drag — no flash from default to saved width.
  const cookieStore = await cookies()
  const initialLayout = parsePanelLayoutValue(
    cookieStore.get(panelLayoutCookieName("home-layout"))?.value
  )

  // Seed the global grid/table view plus each surface's remembered sort so the
  // right layout paints on first load. The active surface is derived
  // client-side in the shell, so the whole per-folder sort map rides down
  // rather than one route's slice.
  const initialViewPrefs = parseHomeViewPrefs(
    cookieStore.get(homeViewPrefsCookieName())?.value
  )

  // Seed rooms, folders, placements, and pins server-side so the grid and the
  // sidebar's Pinned section are populated on first paint — loading them
  // client-side resolves in ~1 frame against the local sidecar, which strobes an
  // empty/loading grid (and an empty Pinned section) when returning home from a
  // canvas. One fetch for the whole group: the lifted store is the single source
  // of truth the sidebar and the content grid share.
  //
  // A failed load must not read as an empty account ("Create your first
  // canvas"), so any failure seeds empty lists *and* flags the store, which
  // shows an error with Retry in place of the grid.
  const failLoad = await hasFixtureFault("home-load")
  const load = <T,>(fetch: () => Promise<T[]>): Promise<T[] | null> =>
    (failLoad
      ? Promise.reject(new Error("fixture fault: home-load"))
      : fetch()
    ).catch((err: unknown) => {
      console.error("Failed to load the home store", err)
      return null
    })
  const [rooms, folders, placements, pins] = await Promise.all([
    load(listRooms),
    load(listFolders),
    load(listRoomPlacements),
    load(listPins),
  ])
  const loadFailed = [rooms, folders, placements, pins].some((r) => r === null)

  return (
    <HomeShell
      initialLayout={initialLayout}
      initialRooms={rooms ?? []}
      initialFolders={folders ?? []}
      initialPlacements={placements ?? []}
      initialPins={pins ?? []}
      initialLoadFailed={loadFailed}
      initialViewPrefs={initialViewPrefs}
    >
      {children}
    </HomeShell>
  )
}
