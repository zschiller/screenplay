import { beforeEach, describe, expect, it, vi } from "vitest"

// The credential gate reuses the room-member check behind /api/yjs/auth and
// Y.Doc sync — `canAccess(roomId, userId)`. We mock it so a test can be a room
// member or an outsider without standing up Postgres; the rooms module's own
// tests cover the membership query itself.
const access = vi.hoisted(() => ({ canAccess: vi.fn(async () => true) }))
vi.mock("@/lib/rooms", () => ({ canAccess: access.canAccess }))

process.env.TERMINAL_AUTH_SECRET = "test-terminal-secret"

import {
  issueTerminalCredential,
  verifyTerminalCredential,
} from "@/lib/sandbox/terminal-credential"

beforeEach(() => {
  vi.clearAllMocks()
  access.canAccess.mockResolvedValue(true)
})

describe("issueTerminalCredential", () => {
  it("issues a credential to a room member", async () => {
    const credential = await issueTerminalCredential({
      roomId: "room-1",
      sessionId: "term-1",
      userId: "user-1",
    })

    expect(credential).not.toBeNull()
    expect(credential?.token).toBeTruthy()
    expect(access.canAccess).toHaveBeenCalledWith("room-1", "user-1")
  })

  it("refuses a non-member", async () => {
    access.canAccess.mockResolvedValue(false)

    const credential = await issueTerminalCredential({
      roomId: "room-1",
      sessionId: "term-1",
      userId: "outsider",
    })

    expect(credential).toBeNull()
  })
})

describe("verifyTerminalCredential", () => {
  it("accepts a freshly minted credential and returns the bound user", async () => {
    const credential = await issueTerminalCredential({
      roomId: "room-1",
      sessionId: "term-1",
      userId: "user-1",
    })

    const result = verifyTerminalCredential(credential!.token, {
      roomId: "room-1",
      sessionId: "term-1",
    })

    expect(result).toEqual({ ok: true, userId: "user-1" })
  })

  it("rejects a credential once it has expired", async () => {
    const mintedAt = 1_000_000
    const credential = await issueTerminalCredential(
      { roomId: "room-1", sessionId: "term-1", userId: "user-1" },
      mintedAt
    )

    // The credential is short-lived: valid moments after minting…
    expect(
      verifyTerminalCredential(
        credential!.token,
        { roomId: "room-1", sessionId: "term-1" },
        mintedAt + 1_000
      )
    ).toEqual({ ok: true, userId: "user-1" })

    // …but refused once its expiry has passed.
    expect(
      verifyTerminalCredential(
        credential!.token,
        { roomId: "room-1", sessionId: "term-1" },
        credential!.expiresAt + 1
      )
    ).toEqual({ ok: false })
  })

  it("rejects a forged token and a credential bound to another room/session", async () => {
    const credential = await issueTerminalCredential({
      roomId: "room-1",
      sessionId: "term-1",
      userId: "user-1",
    })

    // Garbage / no credential — an open URL with nothing valid attached.
    expect(
      verifyTerminalCredential("not-a-real-token", {
        roomId: "room-1",
        sessionId: "term-1",
      })
    ).toEqual({ ok: false })

    // Right structure, forged signature — can't be minted without the secret.
    expect(
      verifyTerminalCredential("room-1.term-1.user-1.9999999999999.deadbeef", {
        roomId: "room-1",
        sessionId: "term-1",
      })
    ).toEqual({ ok: false })

    // A genuine credential, but presented for a different room or session.
    expect(
      verifyTerminalCredential(credential!.token, {
        roomId: "room-2",
        sessionId: "term-1",
      })
    ).toEqual({ ok: false })
    expect(
      verifyTerminalCredential(credential!.token, {
        roomId: "room-1",
        sessionId: "term-2",
      })
    ).toEqual({ ok: false })
  })
})
