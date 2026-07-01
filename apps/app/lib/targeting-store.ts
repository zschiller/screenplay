/**
 * Element-targeting channel (PRD #616, slice #618) between a chat Composer and
 * the Canvas. The Composer lives deep in the chat panel; the crosshair
 * hit-test lives in the Canvas, which owns the iframe DOM bridge and frame
 * geometry. This singleton bridges them the same way `inputStore` bridges
 * shortcut actions into a chat: the Canvas registers a single fulfiller, and a
 * Composer calls `requestPick(branchId)` to enter a one-shot pick.
 *
 * The promise resolves with the picked element (enough for both the inline
 * token and the `Targeted elements:` footer) or `null` when the pick is
 * cancelled (Esc, a miss, a non-eligible frame) — or immediately `null` when no
 * Canvas is mounted (the seed composer, doc chats, the New-Workspace dialog),
 * so the target affordance is a harmless no-op outside a room.
 */

/** A preview element the user picked, resolved by the Canvas hit-test. */
export interface PickedElement {
  /** Lowercase tag name of the deepest picked element (e.g. `button`). */
  tagName: string
  /** The element's `id` attribute, when present. */
  id?: string
  /** Full CSS selector locating the element within its frame. */
  selector: string
  /** The route (page path) the frame is showing. */
  route: string
  /** The iframe layer the element belongs to. */
  iframeLayerId: string
  /** Display label of that frame, for the agent-facing footer. */
  frameLabel: string
}

/** A pending pick the Canvas fulfills: which branch's frames are eligible, and
 *  the resolver to call with the result (or `null` to cancel). */
export interface PickRequest {
  branchId: string
  resolve: (picked: PickedElement | null) => void
}

type Fulfiller = (request: PickRequest) => void

class TargetingStore {
  private fulfiller: Fulfiller | null = null

  /**
   * The Canvas registers itself as the sole pick fulfiller. Returns an
   * unsubscribe that only clears the registration if it's still the current one
   * (guards against a late unmount clobbering a fresh mount).
   */
  register(fulfiller: Fulfiller): () => void {
    this.fulfiller = fulfiller
    return () => {
      if (this.fulfiller === fulfiller) this.fulfiller = null
    }
  }

  /**
   * A Composer requests a one-shot element pick for its bound branch. Resolves
   * with the picked element, or `null` if cancelled or if no Canvas is mounted.
   */
  requestPick(branchId: string): Promise<PickedElement | null> {
    const fulfiller = this.fulfiller
    if (!fulfiller) return Promise.resolve(null)
    return new Promise((resolve) => {
      fulfiller({ branchId, resolve })
    })
  }
}

export const targetingStore = new TargetingStore()
