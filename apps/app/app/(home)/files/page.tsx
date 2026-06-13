import { HomeProvider } from "@/components/home/home-provider"
import { RoomsView } from "@/components/home/rooms-view"
import { listRooms } from "@/lib/rooms-actions"
import { listFolders } from "@/lib/folders-actions"

export const metadata = { title: "All files" }

/**
 * All files — the full canvas list with sort + grid/table controls, plus the
 * user's top-level folders rendered above the files (PRD #475). The first slice
 * of the folder tree: folders are created and listed at the root, but navigating
 * into one lands later.
 */
export default async function FilesPage() {
  // Seed both lists server-side so the grid is populated on first paint, the
  // same way rooms avoid the empty-grid flash on the desktop build.
  const [initialRooms, initialFolders] = await Promise.all([
    listRooms().catch(() => []),
    listFolders().catch(() => []),
  ])

  return (
    <HomeProvider initialRooms={initialRooms} initialFolders={initialFolders}>
      <RoomsView title="All files" showFolders />
    </HomeProvider>
  )
}
