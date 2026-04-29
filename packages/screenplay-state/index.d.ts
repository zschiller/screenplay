export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

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
 * @example
 *   const [user, setUser] = useState<User | null>(null)
 *   useSharedState("user", user)
 *
 *   const [cart, setCart] = useState<CartItem[]>([])
 *   useSharedState("cart", { itemCount: cart.length, total: sum(cart) })
 */
export function useSharedState(key: string, value: JsonValue | undefined): void

/**
 * Imperative writer for non-React code. Returns a remover that drops the key
 * from the published state. Outside a screenplay frame the call is a no-op
 * and the returned remover is a no-op too.
 */
export function setSharedState(
  key: string,
  value: JsonValue | undefined,
): () => void

/** Drop a key from the published state. */
export function clearSharedState(key: string): void

/** Read the last value published under a key. Mostly for tests. */
export function getSharedState(key: string): JsonValue | undefined
