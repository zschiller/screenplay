import { RoomsView } from "@/components/home/rooms-view"

export const metadata = { title: "All files" }

/**
 * All files — the root of the folder tree (PRD #475). Shows the user's top-level
 * folders above the Rooms they keep at root, with sort + grid/table controls and
 * a breadcrumb header. Clicking a folder navigates to `/files/<id>`.
 *
 * Thin by design (#510): the rooms/folders store is server-seeded once in the
 * group layout and lifted into the home shell, which derives the root scope
 * (`folderView`, no current folder) from this URL. The page only selects the
 * view flags.
 */
export default function FilesPage() {
  return <RoomsView title="All files" showFolders />
}
