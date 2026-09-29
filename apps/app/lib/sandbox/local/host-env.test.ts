import { describe, expect, it } from "vitest"

import { devServerEnv, hostChildEnv } from "./host-env"

// What a desktop sidecar's `process.env` looks like once Next's standalone
// `server.js` has booted: the user's own env plus Next's private runtime state.
const sidecarEnv: NodeJS.ProcessEnv = {
  PATH: "/usr/bin",
  HOME: "/Users/zack",
  NODE_ENV: "production",
  __NEXT_PRIVATE_STANDALONE_CONFIG: '{"distDir":"./.next"}',
  __NEXT_PRIVATE_ORIGIN: "http://127.0.0.1:3000",
  NEXT_DEPLOYMENT_ID: "dpl_123",
  TURBOPACK: "1",
  NEXT_PUBLIC_FOO: "kept",
}

describe("hostChildEnv", () => {
  it("drops the host app's Next.js runtime vars and NODE_ENV", () => {
    expect(hostChildEnv(sidecarEnv)).toEqual({
      PATH: "/usr/bin",
      HOME: "/Users/zack",
      NEXT_PUBLIC_FOO: "kept",
    })
  })
})

describe("devServerEnv", () => {
  it("pins NODE_ENV to development over the host's production", () => {
    const env = devServerEnv({}, sidecarEnv)
    expect(env.NODE_ENV).toBe("development")
    expect(env.__NEXT_PRIVATE_STANDALONE_CONFIG).toBeUndefined()
    expect(env.__NEXT_PRIVATE_ORIGIN).toBeUndefined()
    expect(env.NEXT_DEPLOYMENT_ID).toBeUndefined()
    expect(env.TURBOPACK).toBeUndefined()
  })

  it("lets explicit overrides win", () => {
    const env = devServerEnv({ NODE_ENV: "test", PORT: "4000" }, sidecarEnv)
    expect(env.NODE_ENV).toBe("test")
    expect(env.PORT).toBe("4000")
  })
})
