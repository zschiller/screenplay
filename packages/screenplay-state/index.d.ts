export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

/**
 * Mirror a value up to the parent screenplay canvas under the given key. The
 * canvas persists the merged state on the artboard (Yjs-synced) and shows a
 * tiny indicator inside the route pill — hover for the JSON. The state is
 * read-only on the canvas: the editor can see it, not edit it.
 *
 * Outside a screenplay frame (production, standalone dev, anything not
 * iframed inside screenplay) this is a no-op. Nothing ever leaves the page,
 * so it's safe to ship `useSharedState` calls to production.
 *
 * Pick a stable, descriptive `key`. Renaming a key drops the old entry and
 * starts a new one; the canvas treats `sharedState` as last-write-wins per
 * key.
 *
 * Pass `setter` to take updates from other viewers too. When the frame loads,
 * a value the room already holds for `key` wins over the frame's own.
 *
 * @example
 *   const [user, setUser] = useState<User | null>(null)
 *   useSharedState("user", user)
 *
 *   const [cart, setCart] = useState<CartItem[]>([])
 *   useSharedState("cart", { itemCount: cart.length, total: sum(cart) })
 */
export function useSharedState<T extends JsonValue | undefined>(
  key: string,
  value: T,
  setter?: (value: T) => void
): void

/**
 * Imperative writer for non-React code. Returns a remover that drops the key
 * from the published state. Outside a screenplay frame the call is a no-op
 * and the returned remover is a no-op too.
 */
export function setSharedState(
  key: string,
  value: JsonValue | undefined
): () => void

/**
 * Subscribe to updates of a key from other viewers (non-React). Returns an
 * unsubscribe function. Outside a screenplay frame the callback is never
 * invoked and the unsubscribe is a no-op.
 */
export function subscribeSharedState(
  key: string,
  onChange: (value: JsonValue | undefined) => void
): () => void

/** Drop a key from the published state. */
export function clearSharedState(key: string): void

/** Read the last value published under a key. Mostly for tests. */
export function getSharedState(key: string): JsonValue | undefined

/**
 * The part of a zustand store `shareStore` uses. A `create()` hook and a
 * vanilla `createStore()` store both have it.
 */
export interface ShareableStore<T> {
  getState(): T
  setState(partial: Partial<T>): void
  subscribe(listener: (state: T, previous: T) => void): () => void
}

/**
 * Share a whole zustand store with every viewer of the frame under one key.
 * The store's plain-JSON fields are published; changes from other viewers are
 * merged back with `setState`, so the store's actions keep working.
 *
 * Fields holding functions, or values JSON can't round-trip (`Date`, `Map`,
 * `Set`, class instances, `undefined`, `NaN`), are never published and never
 * overwritten. Returns a function that stops sharing.
 *
 * Outside a screenplay frame (production, standalone dev) this is a no-op.
 *
 * @example
 *   export const useSales = create((set) => ({
 *     contactOpen: false,
 *     plan: "Growth",
 *     seats: 5,
 *     open: (plan) => set({ contactOpen: true, plan }),
 *     close: () => set({ contactOpen: false }),
 *   }))
 *
 *   shareStore("sales", useSales)
 */
export function shareStore<T>(key: string, store: ShareableStore<T>): () => void
