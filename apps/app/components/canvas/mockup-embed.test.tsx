// @vitest-environment jsdom
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { MockupEmbed } from "./mockup-embed"
import { fileModal } from "@/lib/canvas/file-modal"
import { createCanvasOps } from "@/lib/canvas/ops"
import { YjsConnectionProvider } from "@/lib/yjs/context"
import { getRoomCollections } from "@/lib/yjs/schema"

vi.mock("@/hooks/use-mockup-runtime", () => ({ useMockupRuntime: () => null }))
vi.mock("@/hooks/use-mockup-refs", () => ({ useMockupRefs: () => null }))

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver

afterEach(() => {
  act(() => fileModal.close())
  cleanup()
})

function room() {
  const doc = new Y.Doc()
  const ops = createCanvasOps(getRoomCollections(doc))
  const wrap = (children: ReactNode) => (
    <YjsConnectionProvider
      value={{ doc, awareness: new Awareness(doc), roomId: "room" }}
    >
      {children}
    </YjsConnectionProvider>
  )
  return { ops, wrap }
}

describe("MockupEmbed (#1888)", () => {
  it("captions the page with the Mockup’s name, and Open shows it in the modal", () => {
    const { ops, wrap } = room()
    const id = ops.createFile({
      kind: "mockup",
      title: "Option B · Suggestions",
    })
    render(wrap(<MockupEmbed id={id} name="Option B" selected={false} />))

    expect(
      screen
        .getByTestId("mockup-embed")
        .querySelector('[data-slot="mockup-embed-name"]')?.textContent
    ).toBe("Option B · Suggestions")
    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    expect(fileModal.current()).toBe(id)
  })

  it("follows a view’s id to its file", () => {
    const { ops, wrap } = room()
    const id = ops.createFile({ kind: "mockup", title: "Hero" })
    const { viewId } = ops.placeFile(id)!
    render(wrap(<MockupEmbed id={viewId} name="Hero" selected={false} />))
    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    expect(fileModal.current()).toBe(id)
  })

  it("takes the pointer on a click, and lets it go on a click outside or Esc", () => {
    const { ops, wrap } = room()
    const id = ops.createFile({ kind: "mockup", title: "Hero" })
    render(wrap(<MockupEmbed id={id} name="Hero" selected={false} />))
    const embed = screen.getByTestId("mockup-embed")

    fireEvent.click(screen.getByTestId("mockup-embed-overlay"))
    expect(embed.hasAttribute("data-focused")).toBe(true)
    expect(screen.queryByTestId("mockup-embed-overlay")).toBeNull()

    fireEvent.pointerDown(document.body)
    expect(embed.hasAttribute("data-focused")).toBe(false)

    fireEvent.click(screen.getByTestId("mockup-embed-overlay"))
    fireEvent.keyDown(window, { key: "Escape" })
    expect(embed.hasAttribute("data-focused")).toBe(false)
  })

  it("doesn’t take the pointer when the press was a drag", () => {
    const { ops, wrap } = room()
    const id = ops.createFile({ kind: "mockup", title: "Hero" })
    render(wrap(<MockupEmbed id={id} name="Hero" selected={false} />))
    const overlay = screen.getByTestId("mockup-embed-overlay")
    fireEvent.pointerDown(overlay, { clientX: 10, clientY: 10 })
    fireEvent.click(overlay, { clientX: 60, clientY: 10 })
    expect(
      screen.getByTestId("mockup-embed").hasAttribute("data-focused")
    ).toBe(false)
  })

  it("shows a deleted Mockup’s name struck through", () => {
    const { ops, wrap } = room()
    const id = ops.createFile({ kind: "mockup", title: "Hero" })
    render(wrap(<MockupEmbed id={id} name="Hero v1" selected={false} />))
    act(() => {
      ops.deleteFiles([id])
    })
    const missing = screen.getByTestId("mockup-embed-missing")
    expect(missing.querySelector("s")?.textContent).toBe("Hero v1")
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull()
  })
})
