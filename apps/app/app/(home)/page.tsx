import { HomeProvider } from "@/components/home/home-provider"
import { RoomsView } from "@/components/home/rooms-view"
import { listRooms } from "@/lib/rooms-actions"

/**
 * Recents — the flat, recency-ordered list of the user's canvases. The default
 * home landing; auth is handled by the group layout.
 */
export default async function RecentsPage() {
  // Fetch rooms server-side so the grid is populated on the first paint.
  // Loading them client-side resolves in ~1 frame against the local sidecar,
  // which strobes an empty/loading grid when returning home from a canvas.
  const initialRooms = await listRooms().catch(() => [])

  return (
    <HomeProvider initialRooms={initialRooms}>
      {/* Recents is always recency-first — no sort control. */}
      <RoomsView title="Recents" showSort={false} />
    </HomeProvider>
  )
}
