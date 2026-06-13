import { HomeProvider } from "@/components/home/home-provider"
import { RoomsView } from "@/components/home/rooms-view"
import { listRooms } from "@/lib/rooms-actions"

export const metadata = { title: "All files" }

/**
 * All files — the full canvas list with sort + grid/table controls. Becomes the
 * folder tree later; for now it's the sortable flat view.
 */
export default async function CanvasesPage() {
  const initialRooms = await listRooms().catch(() => [])

  return (
    <HomeProvider initialRooms={initialRooms}>
      <RoomsView title="All files" />
    </HomeProvider>
  )
}
