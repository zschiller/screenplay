/**
 * Requests to move this member's view of the canvas, raised when the
 * Coordinator's `show_on_canvas` completes in a turn this client asked for
 * (`lib/chat-store.ts`) and applied by the canvas's camera
 * (`components/canvas/canvas.tsx`). `ids` names frames, documents or Groups;
 * empty means fit the whole canvas. A request with no `chatId` is this
 * member's own click, such as a question's Mockup link (#1644).
 */
export type ViewRequest = { chatId?: string; ids: string[] }

type Listener = (request: ViewRequest) => void

const listeners = new Set<Listener>()

export const viewRequests = {
  emit(request: ViewRequest) {
    for (const listener of listeners) listener(request)
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

/** The ids a `show_on_canvas` call's input names, tolerating any shape. */
export function viewRequestIds(rawInput: unknown): string[] {
  if (!rawInput || typeof rawInput !== "object") return []
  const ids = (rawInput as { ids?: unknown }).ids
  return Array.isArray(ids)
    ? ids.filter((id): id is string => typeof id === "string")
    : []
}
