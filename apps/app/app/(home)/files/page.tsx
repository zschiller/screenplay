import { HomeProvider } from "@/components/home/home-provider"
import { RoomsView } from "@/components/home/rooms-view"
import { listRooms } from "@/lib/rooms-actions"
import { listFolders, listRoomPlacements } from "@/lib/folders-actions"

export const metadata = { title: "All files" }

/**
 * All files — the root of the folder tree (PRD #475). Shows the user's top-level
 * folders above the Rooms they keep at root, with sort + grid/table controls and
 * a breadcrumb header. Clicking a folder navigates to `/files/<id>`.
 */
export default async function FilesPage() {
  // Seed rooms, folders, and the user's placements server-side so the grid is
  // populated on first paint — the same way rooms avoid the empty-grid flash on
  // the desktop build.
  const [initialRooms, initialFolders, initialPlacements] = await Promise.all([
    listRooms().catch(() => []),
    listFolders().catch(() => []),
    listRoomPlacements().catch(() => []),
  ])

  return (
    <HomeProvider
      initialRooms={initialRooms}
      initialFolders={initialFolders}
      initialPlacements={initialPlacements}
      folderView
      currentFolderId={null}
    >
      <RoomsView title="All files" showFolders />
    </HomeProvider>
  )
}
