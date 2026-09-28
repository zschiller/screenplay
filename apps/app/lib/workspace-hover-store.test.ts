import { describe, expect, it } from "vitest"
import { workspaceHoverStore } from "./workspace-hover-store"

describe("workspaceHoverStore", () => {
  it("keeps the newer hover when an older one clears late", () => {
    const a = { branchId: "a", source: "workspace" } as const
    const b = { branchId: "b", source: "workspace" } as const
    workspaceHoverStore.set(a)
    workspaceHoverStore.set(b)
    workspaceHoverStore.clear(a)
    expect(workspaceHoverStore.get()).toEqual(b)
    workspaceHoverStore.clear(b)
    expect(workspaceHoverStore.get()).toBeNull()
  })

  it("notifies only on a real change", () => {
    let calls = 0
    const off = workspaceHoverStore.subscribe(() => calls++)
    const h = { branchId: "a", source: "frame" } as const
    workspaceHoverStore.set(h)
    workspaceHoverStore.set({ ...h })
    workspaceHoverStore.clear({ branchId: "a", source: "workspace" })
    workspaceHoverStore.clear(h)
    off()
    expect(calls).toBe(2)
  })

  it("keeps a Group hover apart from a frame hover on the same Workspace", () => {
    const frame = { branchId: "a", source: "frame" } as const
    const group = { branchId: "a", source: "group" } as const
    workspaceHoverStore.set(frame)
    workspaceHoverStore.set(group)
    workspaceHoverStore.clear(frame)
    expect(workspaceHoverStore.get()).toEqual(group)
    workspaceHoverStore.clear(group)
    expect(workspaceHoverStore.get()).toBeNull()
  })
})
