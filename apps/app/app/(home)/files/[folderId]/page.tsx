import { redirect } from "next/navigation"
import { HomeProvider } from "@/components/home/home-provider"
import { RoomsView } from "@/components/home/rooms-view"
import { listRooms } from "@/lib/rooms-actions"
import { listFolders, listRoomPlacements } from "@/lib/folders-actions"

export const metadata = { title: "Folder" }

/**
 * A folder within the tree (PRD #475). Shows only this folder's contents — its
 * sub-folders above the Rooms filed into it — partitioned and sorted by the
 * active key, with the breadcrumb trail derived from the folder tree. The folder
 * id is the single dynamic segment; the ancestor chain is resolved server-side
 * by walking `parentFolderId`, so the URL is deep-linkable and survives a
 * refresh / browser back-forward.
 */
export default async function FolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>
}) {
  const { folderId } = await params
  const [initialRooms, initialFolders, initialPlacements] = await Promise.all([
    listRooms().catch(() => []),
    listFolders().catch(() => []),
    listRoomPlacements().catch(() => []),
  ])

  // `listFolders` is owner-scoped, so a folder missing from it is either gone or
  // someone else's — a stale/forged link. Send it back to the root rather than
  // render a folder the user can't see.
  if (!initialFolders.some((folder) => folder.id === folderId)) {
    redirect("/files")
  }

  return (
    <HomeProvider
      initialRooms={initialRooms}
      initialFolders={initialFolders}
      initialPlacements={initialPlacements}
      folderView
      currentFolderId={folderId}
    >
      <RoomsView title="All files" showFolders />
    </HomeProvider>
  )
}
