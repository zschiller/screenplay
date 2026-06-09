import { describe, expect, it } from "vitest"

import type { GhCli } from "@/lib/github-local/gh-cli"
import { makeGitHubTokenResolver } from "@/lib/github-local/token-resolver"
import {
  makeKeychainTokenStore,
  makeLayeredTokenStore,
  type KeychainEntry,
  type TokenStore,
} from "@/lib/github-local/token-store"

function fakeGh(token: string | null): GhCli {
  return { getToken: async () => token }
}

function memoryStore(initial: string | null = null): TokenStore {
  let token = initial
  return {
    async get() {
      return token
    },
    async set(t) {
      token = t
    },
    async clear() {
      token = null
    },
  }
}

/** A keychain whose every operation throws — the no-platform-keychain case. */
function brokenKeychain(): KeychainEntry {
  return {
    getPassword(): string | null {
      throw new Error("Couldn't access platform storage: AccessDenied")
    },
    setPassword() {
      throw new Error("Couldn't access platform storage: AccessDenied")
    },
    deletePassword(): boolean {
      throw new Error("Couldn't access platform storage: AccessDenied")
    },
  }
}

describe("local GitHub token resolver", () => {
  it("prefers the gh CLI's token when gh is available", async () => {
    const resolve = makeGitHubTokenResolver({
      gh: fakeGh("gh-token"),
      store: async () => memoryStore("stored-token"),
    })
    expect(await resolve()).toBe("gh-token")
  })

  it("falls through to the stored device-flow token when gh is absent", async () => {
    const resolve = makeGitHubTokenResolver({
      gh: fakeGh(null),
      store: async () => memoryStore("stored-token"),
    })
    expect(await resolve()).toBe("stored-token")
  })

  it("resolves null when neither source has a token", async () => {
    const resolve = makeGitHubTokenResolver({
      gh: fakeGh(null),
      store: async () => memoryStore(),
    })
    expect(await resolve()).toBeNull()
  })
})

describe("token store", () => {
  it("round-trips and clears a token through the interface", async () => {
    const store = memoryStore()
    expect(await store.get()).toBeNull()
    await store.set("gho_tok")
    expect(await store.get()).toBe("gho_tok")
    await store.clear()
    expect(await store.get()).toBeNull()
  })

  it("keychain store round-trips through a working entry", async () => {
    let password: string | null = null
    const store = makeKeychainTokenStore({
      getPassword: () => password,
      setPassword(p) {
        password = p
      },
      deletePassword() {
        password = null
        return true
      },
    })
    await store.set("gho_tok")
    expect(await store.get()).toBe("gho_tok")
    await store.clear()
    expect(await store.get()).toBeNull()
  })

  it("degrades to the fallback when the keychain refuses every operation", async () => {
    const store = makeLayeredTokenStore(
      makeKeychainTokenStore(brokenKeychain()),
      memoryStore()
    )
    await store.set("gho_tok")
    expect(await store.get()).toBe("gho_tok")
    await store.clear()
    expect(await store.get()).toBeNull()
  })

  it("clear empties both layers so a disconnect leaves nothing behind", async () => {
    const primary = memoryStore("primary-tok")
    const fallback = memoryStore("fallback-tok")
    const store = makeLayeredTokenStore(primary, fallback)

    await store.clear()

    expect(await primary.get()).toBeNull()
    expect(await fallback.get()).toBeNull()
  })
})
