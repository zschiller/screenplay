// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import * as Y from "yjs"
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from "y-protocols/awareness"

import type { PageData } from "@/lib/types"
import { ViewingProvider } from "@/lib/viewer/context"
import { YjsConnectionProvider } from "@/lib/yjs/context"
import type { CanvasPresence } from "@/lib/yjs/react"
import { Cursors } from "./cursors"

afterEach(cleanup)

const PAGES: PageData[] = [
  { id: "page-1", name: "Homepage", order: 0 },
  { id: "p2", name: "Pricing", order: 1 },
]

function renderOn(
  pageId: string,
  people: Record<string, string | undefined>,
  { viewing = false, viewers = [] as string[] } = {}
) {
  const local = new Awareness(new Y.Doc())
  for (const [name, peerPage] of Object.entries(people)) {
    const peer = new Awareness(new Y.Doc())
    const state: CanvasPresence = {
      identity: { id: name, name },
      pointer: { x: 10, y: 10 },
      viewport: { x: 0, y: 0, zoom: 1 },
      color: "#ff6ec7",
      selectedIframeLayerIds: [],
      ...(peerPage ? { pageId: peerPage } : {}),
      ...(viewers.includes(name) ? { viewer: true } : {}),
    }
    peer.setLocalState(state)
    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(peer, [peer.clientID]),
      "remote"
    )
  }
  const cursors = (
    <YjsConnectionProvider
      value={{ doc: local.doc, awareness: local, roomId: "room" }}
    >
      <Cursors
        viewport={{ x: 0, y: 0, zoom: 1 }}
        pages={PAGES}
        pageId={pageId}
      />
    </YjsConnectionProvider>
  )
  act(() => {
    render(
      viewing ? (
        <ViewingProvider
          value={{
            person: { id: "ana@example.com", name: "Ana Lima" },
            roomId: "room",
            shareKey: "key",
          }}
        >
          {cursors}
        </ViewingProvider>
      ) : (
        cursors
      )
    )
  })
}

describe("Cursors across pages (#1840)", () => {
  it("draws only the people on your page", () => {
    renderOn("p2", { Maya: "p2", Ben: "page-1", Ada: undefined })
    expect(screen.queryByText("Maya")).not.toBeNull()
    expect(screen.queryByText("Ben")).toBeNull()
    expect(screen.queryByText("Ada")).toBeNull()
  })

  it("puts someone with no page, or a gone one, on the first page", () => {
    renderOn("page-1", { Ada: undefined, Cy: "deleted", Maya: "p2" })
    expect(screen.queryByText("Ada")).not.toBeNull()
    expect(screen.queryByText("Cy")).not.toBeNull()
    expect(screen.queryByText("Maya")).toBeNull()
  })
})

describe("the Host badge on a canvas link (#1932)", () => {
  it("marks the one presence the server didn't stamp as a viewer", () => {
    renderOn(
      "page-1",
      { Maya: undefined, Ben: undefined },
      {
        viewing: true,
        viewers: ["Ben"],
      }
    )
    expect(screen.queryByText("Maya (Host)")).not.toBeNull()
    expect(screen.queryByText("Ben")).not.toBeNull()
    expect(screen.getAllByText(/\(Host\)/)).toHaveLength(1)
  })

  it("marks no one on the host's own canvas", () => {
    renderOn("page-1", { Maya: undefined, Ben: undefined })
    expect(screen.queryByText(/\(Host\)/)).toBeNull()
  })
})
