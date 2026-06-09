import "server-only"

/**
 * Where the local build keeps the device-flow GitHub token (PRD #428). One
 * narrow interface so where secrets live is a single swap: the default
 * implementation is the **OS keychain** (via `@napi-rs/keyring` — the token is
 * consumed by the Node sidecar, so it must live where the sidecar can read it
 * directly, not behind a Rust-side Tauri plugin), degrading to the surviving
 * `kv_store` table when no platform keychain is available. Most users never
 * touch this store at all — `gh`-authed users get their token from the
 * adapter on every call; the store only backs the device-flow fallback.
 */
export interface TokenStore {
  get(): Promise<string | null>
  set(token: string): Promise<void>
  clear(): Promise<void>
}

/** Keychain entry coordinates: one token per install, not per user — the local
 *  build runs as the single seeded local user. */
const KEYCHAIN_SERVICE = "space.screenplay.desktop"
const KEYCHAIN_ACCOUNT = "github-token"
const KV_KEY = "github-local:device-token"

/** The keyring `Entry` surface we use, so tests can fake the binding. */
export interface KeychainEntry {
  getPassword(): string | null
  setPassword(password: string): void
  deletePassword(): boolean
}

async function loadKeychainEntry(): Promise<KeychainEntry | null> {
  try {
    // Dynamic so the hosted build (and a desktop install whose platform
    // package failed to ship) never pays for — or crashes on — the native
    // binding at module load.
    const { Entry } = await import("@napi-rs/keyring")
    return new Entry(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
  } catch {
    return null
  }
}

export function makeKeychainTokenStore(entry: KeychainEntry): TokenStore {
  return {
    async get() {
      return entry.getPassword()
    },
    async set(token) {
      entry.setPassword(token)
    },
    async clear() {
      try {
        entry.deletePassword()
      } catch {
        // Nothing stored — already clear.
      }
    },
  }
}

export function makeKvTokenStore(): TokenStore {
  // The kv module touches the database at import time; load it per operation
  // so merely constructing a store (or importing this module in a test) never
  // requires a configured DB.
  const loadKv = () => import("@/lib/kv").then((m) => m.kv)
  return {
    async get() {
      return await (await loadKv()).get<string>(KV_KEY)
    },
    async set(token) {
      await (await loadKv()).set(KV_KEY, token)
    },
    async clear() {
      await (await loadKv()).del(KV_KEY)
    },
  }
}

/**
 * Layer a preferred store over a fallback so a missing/locked-down keychain
 * degrades instead of breaking auth (a keychain can be readable yet refuse
 * writes — observed as `AccessDenied` on headless Linux — so each operation
 * degrades independently rather than probing once up front):
 *
 *  - `set` writes to the primary, falling back on failure;
 *  - `get` reads the primary first, then the fallback;
 *  - `clear` clears both, best-effort each, so a disconnect never leaves a
 *    token behind in whichever layer happened to hold it.
 */
export function makeLayeredTokenStore(
  primary: TokenStore,
  fallback: TokenStore
): TokenStore {
  return {
    async get() {
      try {
        const token = await primary.get()
        if (token) return token
      } catch {
        // Fall through to the fallback layer.
      }
      return fallback.get()
    },
    async set(token) {
      try {
        await primary.set(token)
        // The token now lives in the primary; drop any stale fallback copy so
        // the two layers can't disagree later.
        await fallback.clear().catch(() => {})
      } catch {
        await fallback.set(token)
      }
    },
    async clear() {
      await Promise.all([
        (async () => {
          try {
            await primary.clear()
          } catch {
            // Best-effort: an unavailable keychain has nothing to clear.
          }
        })(),
        fallback.clear().catch(() => {}),
      ])
    },
  }
}

let storePromise: Promise<TokenStore> | null = null

/**
 * The local build's token store singleton: OS keychain over the `kv_store`
 * fallback when the binding loads, the fallback alone when it doesn't.
 */
export function getLocalTokenStore(): Promise<TokenStore> {
  if (!storePromise) {
    storePromise = (async () => {
      const entry = await loadKeychainEntry()
      const kvStore = makeKvTokenStore()
      return entry
        ? makeLayeredTokenStore(makeKeychainTokenStore(entry), kvStore)
        : kvStore
    })()
  }
  return storePromise
}
