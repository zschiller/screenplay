/**
 * A Document or Mockup tile being dragged out of the chat panel (#1887), by
 * its file id, so the canvas can take the drop: while one is in the air the
 * canvas lays a drop surface over its layers (a frame's page would otherwise
 * swallow the drag) and shows where it would land. Null when nothing is
 * dragged. The drag also carries the id as {@link FILE_DRAG_TYPE}.
 */

/** The drag data type a tile's file id travels as. */
export const FILE_DRAG_TYPE = "application/x-screenplay-file"

type Listener = () => void

let draggingId: string | null = null
const listeners = new Set<Listener>()

function set(next: string | null) {
  if (next === draggingId) return
  draggingId = next
  for (const listener of listeners) listener()
}

export const fileDrag = {
  start(fileId: string) {
    set(fileId)
  },
  end() {
    set(null)
  },
  current(): string | null {
    return draggingId
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
