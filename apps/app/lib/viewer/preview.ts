import type { ExposedPort } from "@/lib/preview-exposure/types"

/** A preview on the canvas: what the host's frames load, and its Workspace. */
export interface PreviewFrame {
  iframeUrl?: string
  workspace?: { sandboxName: string; devPort: number }
}

/** What a viewer's frame loads and whether its dev server answers. */
export interface ViewerPreview {
  /** The host's preview URL, on the preview exposure's origin for viewers. */
  url: string
  live: boolean
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * A viewer's view of one Workspace preview on a canvas (Sharing, #1932). The
 * host's frames load the preview on the Mac's loopback; a viewer's frame
 * loads its own copy from the preview exposure's origin for the same port.
 * Only a preview of one of the canvas's Workspaces is looked up, so a viewer
 * can never expose any other port on the Mac. Null for any other.
 */
export async function viewerPreview({
  frames,
  sandboxName,
  devPort,
  expose,
  probe,
}: {
  frames: readonly PreviewFrame[]
  sandboxName: string
  devPort: number
  expose: (port: number) => Promise<ExposedPort>
  probe: (sandboxName: string, devPort: number) => Promise<boolean>
}): Promise<ViewerPreview | null> {
  const frame = frames.find(
    (f) =>
      f.iframeUrl &&
      f.workspace?.sandboxName === sandboxName &&
      f.workspace.devPort === devPort
  )
  if (!frame?.iframeUrl) return null
  let url: URL
  try {
    url = new URL(frame.iframeUrl)
  } catch {
    return null
  }
  const port = Number(url.port)
  const path = url.pathname === "/" ? "" : url.pathname
  const [viewerUrl, live] = await Promise.all([
    LOOPBACK.has(url.hostname) && Number.isInteger(port) && port > 0
      ? expose(port).then((exposed) => `${exposed.browserOrigin}${path}`)
      : frame.iframeUrl,
    probe(sandboxName, devPort),
  ])
  return { url: viewerUrl, live }
}

/** The path a viewer asks about a preview at, under the canvas link. */
export function viewerPreviewPath(
  roomId: string,
  shareKey: string,
  target: { sandboxName: string; devPort: number }
): string {
  const query = new URLSearchParams({
    sandbox: target.sandboxName,
    port: String(target.devPort),
  })
  return `/s/${encodeURIComponent(roomId)}/${shareKey}/preview?${query}`
}
