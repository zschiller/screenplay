/**
 * Which Document or Mockup this member has open in the file modal (#1885),
 * by its file id: a tile in a chat reply, a double-click on a view, or a
 * mention of a file with no view opens it, and the canvas shows the modal
 * (`components/canvas/file-modal.tsx`). One at a time; null when closed.
 */

type Listener = () => void

let openId: string | null = null
const listeners = new Set<Listener>()

function set(next: string | null) {
  if (next === openId) return
  openId = next
  for (const listener of listeners) listener()
}

export const fileModal = {
  open(fileId: string) {
    set(fileId)
  },
  close() {
    set(null)
  },
  current(): string | null {
    return openId
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
