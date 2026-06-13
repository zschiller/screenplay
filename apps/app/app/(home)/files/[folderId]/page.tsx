import { redirect } from "next/navigation"
import { RoomsView } from "@/components/home/rooms-view"
import { listFolders } from "@/lib/folders-actions"

export const metadata = { title: "Folder" }

/**
 * A folder within the tree (PRD #475). Shows only this folder's contents — its
 * sub-folders above the Rooms filed into it — partitioned and sorted by the
 * active key, with the breadcrumb trail derived from the folder tree. The folder
 * id is the single dynamic segment; the URL is deep-linkable and survives a
 * refresh / browser back-forward.
 *
 * Thin by design (#510): the rooms/folders store is server-seeded once in the
 * group layout and lifted into the home shell, which scopes it to this folder
 * from the URL. The page's only server work is the deep-link guard below — it
 * reads the owner-scoped folder list so a stale/forged link never paints a
 * folder the user can't see.
 */
export default async function FolderPage({
  params,
}: {
  params: Promise<{ folderId: string }>
}) {
  const { folderId } = await params

  // `listFolders` is owner-scoped, so a folder missing from it is either gone or
  // someone else's — a stale/forged link. Send it back to the root rather than
  // render a folder the user can't see.
  const folders = await listFolders().catch(() => [])
  if (!folders.some((folder) => folder.id === folderId)) {
    redirect("/files")
  }

  return <RoomsView title="All files" showFolders />
}
