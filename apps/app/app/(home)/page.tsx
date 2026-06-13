import { RoomsView } from "@/components/home/rooms-view"

/**
 * Recents — the flat, recency-ordered list of the user's canvases. The default
 * home landing; auth is handled by the group layout.
 *
 * Thin by design (#510): the rooms/folders store is server-seeded once in the
 * group layout and lifted into the home shell, so this page only selects
 * Recents' view flags. The URL (`/`) scopes the shared store to the flat,
 * cross-folder list — Recents is always recency-first, so no sort control.
 */
export default function RecentsPage() {
  return <RoomsView title="Recents" showSort={false} />
}
