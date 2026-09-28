// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import {
  readDefaultModel,
  useDefaultModel,
  writeDefaultModel,
} from "@/lib/default-model-store"

describe("default model store", () => {
  beforeEach(() => window.localStorage.clear())

  it("is unset until the user picks one", () => {
    expect(readDefaultModel()).toBeNull()
  })

  it("seeds from the old last-used model so upgrading changes nothing", () => {
    window.localStorage.setItem("agent-last-model", "harness:codex")
    expect(readDefaultModel()).toBe("harness:codex")
  })

  it("prefers the Settings default over the old last-used model", () => {
    window.localStorage.setItem("agent-last-model", "harness:codex")
    writeDefaultModel("harness:claude-code:opus")
    expect(readDefaultModel()).toBe("harness:claude-code:opus")
  })

  it("tells open subscribers when the default changes", () => {
    const { result } = renderHook(() => useDefaultModel())
    expect(result.current).toBeNull()
    act(() => writeDefaultModel("harness:claude-code:sonnet"))
    expect(result.current).toBe("harness:claude-code:sonnet")
  })

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked")
    })
    expect(readDefaultModel()).toBeNull()
    vi.restoreAllMocks()
  })
})
