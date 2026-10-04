// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/yjs/context", () => ({ useRoomId: () => "room-1" }))

import { useMockupRefs } from "./use-mockup-refs"

afterEach(() => vi.unstubAllGlobals())

describe("useMockupRefs", () => {
  it("needs nothing for a page without references", () => {
    const fetch = vi.fn()
    vi.stubGlobal("fetch", fetch)
    const { result } = renderHook(() => useMockupRefs("m-1", "<p>A</p>"))
    expect(result.current).toEqual({})
    expect(fetch).not.toHaveBeenCalled()
  })

  it("waits for a page's references, then logs the ones that didn't resolve", async () => {
    const resources = {
      "skill:explore/a.js": { type: "text/javascript", data: "YQ==" },
      "files:gone.png": null,
    }
    const fetch = vi.fn(async () => Response.json({ resources }))
    vi.stubGlobal("fetch", fetch)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    const { result } = renderHook(() =>
      useMockupRefs(
        "m-2",
        `<script src="skill:explore/a.js"></script><img src="files:gone.png">`
      )
    )
    expect(result.current).toBeNull()
    await waitFor(() => expect(result.current).toEqual(resources))

    expect(fetch).toHaveBeenCalledWith("/api/mockup-refs/room-1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mockupId: "m-2",
        refs: ["skill:explore/a.js", "files:gone.png"],
      }),
    })
    expect(warn).toHaveBeenCalledWith(
      "Mockup m-2: couldn’t resolve files:gone.png"
    )
    warn.mockRestore()
  })
})
