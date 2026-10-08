// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"

import { ViewingProvider } from "@/lib/viewer/context"
import type { PeerPresence } from "@/lib/yjs/react"
import { PagePeople } from "./page-people"

afterEach(cleanup)

function person(name: string, viewer?: boolean): PeerPresence {
  return {
    identity: { id: name, name },
    color: "#ff6ec7",
    selectedIframeLayerIds: [],
    ...(viewer ? { viewer } : {}),
  }
}

function viewing(children: ReactNode) {
  return (
    <ViewingProvider
      value={{
        person: { id: "ana@example.com", name: "Ana Lima" },
        roomId: "room",
        shareKey: "key",
      }}
    >
      {children}
    </ViewingProvider>
  )
}

const avatars = () =>
  [...screen.getByRole("img").children].map((a) => a.textContent)

describe("the Host's avatar on a canvas link (#1932)", () => {
  it("badges the Host and puts them last", () => {
    render(
      viewing(<PagePeople people={[person("Maya"), person("Ben", true)]} />)
    )
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "Maya (host), Ben"
    )
    expect(avatars()).toEqual(["B", "M"])
    expect(document.querySelectorAll("[data-slot=avatar-badge]")).toHaveLength(
      1
    )
  })

  it("keeps the Host shown when the rest collapse into a count", () => {
    const viewers = ["Ben", "Cy", "Di", "Ed"].map((n) => person(n, true))
    render(viewing(<PagePeople people={[person("Maya"), ...viewers]} />))
    expect(avatars()).toEqual(["B", "C", "M", "+2"])
  })

  it("badges no one on the host's own canvas", () => {
    render(<PagePeople people={[person("Maya"), person("Ben")]} />)
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Maya, Ben")
    expect(document.querySelectorAll("[data-slot=avatar-badge]")).toHaveLength(
      0
    )
  })
})
