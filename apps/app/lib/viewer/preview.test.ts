import { describe, expect, it } from "vitest"

import { viewerPreview, viewerPreviewPath } from "@/lib/viewer/preview"

const frames = [
  {
    iframeUrl: "http://localhost:6123",
    workspace: { sandboxName: "ws-a", devPort: 5173 },
  },
  { iframeUrl: "https://example.com" },
]

const tailnet = async (port: number) => ({
  browserOrigin: `https://mac.tail1234.ts.net:${port}`,
})

describe("a viewer's preview", () => {
  it("loads the preview exposure's origin for the frame's port", async () => {
    const exposed: number[] = []
    const preview = await viewerPreview({
      frames,
      sandboxName: "ws-a",
      devPort: 5173,
      expose: (port) => {
        exposed.push(port)
        return tailnet(port)
      },
      probe: async () => true,
    })
    expect(preview).toEqual({
      url: "https://mac.tail1234.ts.net:6123",
      live: true,
    })
    expect(exposed).toEqual([6123])
  })

  it("keeps the preview's path", async () => {
    const preview = await viewerPreview({
      frames: [
        {
          iframeUrl: "http://127.0.0.1:4048/w/checkout",
          workspace: { sandboxName: "checkout", devPort: 3000 },
        },
      ],
      sandboxName: "checkout",
      devPort: 3000,
      expose: tailnet,
      probe: async () => true,
    })
    expect(preview?.url).toBe("https://mac.tail1234.ts.net:4048/w/checkout")
  })

  it("exposes nothing for a preview no frame on the canvas shows", async () => {
    const exposed: number[] = []
    for (const [sandboxName, devPort] of [
      ["ws-a", 3000],
      ["ws-b", 5173],
    ] as const) {
      expect(
        await viewerPreview({
          frames,
          sandboxName,
          devPort,
          expose: (port) => {
            exposed.push(port)
            return tailnet(port)
          },
          probe: async () => true,
        })
      ).toBeNull()
    }
    expect(exposed).toEqual([])
  })

  it("says when the dev server doesn't answer yet", async () => {
    const preview = await viewerPreview({
      frames,
      sandboxName: "ws-a",
      devPort: 5173,
      expose: tailnet,
      probe: async () => false,
    })
    expect(preview?.live).toBe(false)
  })

  it("is asked about under the canvas link", () => {
    expect(
      viewerPreviewPath("room-1", "k3y", { sandboxName: "ws a", devPort: 5173 })
    ).toBe("/s/room-1/k3y/preview?sandbox=ws+a&port=5173")
  })
})
