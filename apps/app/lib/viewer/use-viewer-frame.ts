"use client"

import { useMemo, useState } from "react"

import type { PreviewProbe } from "@/hooks/use-dev-server-probe"
import { withBasePath } from "@/lib/base-path"
import { useViewing } from "@/lib/viewer/context"
import { type ViewerPreview, viewerPreviewPath } from "@/lib/viewer/preview"

interface FrameRecord {
  iframeUrl?: string
  workspace?: { sandboxName: string; devPort: number }
}

/**
 * A frame as this page loads it (Sharing, #1932). The host's frames load the
 * preview the record names. A viewer's frame is its own copy from the
 * preview exposure's origin for viewers, which the canvas link's preview
 * route says, and that route stands in for the host's preview probe too: the
 * probe is a server action, which the viewer listener refuses. Until the
 * route has answered, a viewer's frame has no URL and reads as starting.
 */
export function useViewerFrame<T extends FrameRecord>(
  record: T
): { frame: T; probe?: PreviewProbe } {
  const viewing = useViewing()
  const [urls, setUrls] = useState<Record<string, string>>({})
  const probe = useMemo<PreviewProbe | undefined>(() => {
    if (!viewing) return undefined
    return async (sandboxName, devPort) => {
      const res = await fetch(
        withBasePath(
          viewerPreviewPath(viewing.roomId, viewing.shareKey, {
            sandboxName,
            devPort,
          })
        ),
        { cache: "no-store" }
      )
      if (!res.ok) return false
      const preview = (await res.json()) as ViewerPreview
      const key = previewKey(sandboxName, devPort)
      setUrls((known) =>
        known[key] === preview.url ? known : { ...known, [key]: preview.url }
      )
      return preview.live
    }
  }, [viewing])
  const workspace = record.workspace
  const url = workspace
    ? urls[previewKey(workspace.sandboxName, workspace.devPort)]
    : undefined
  const frame = useMemo(() => {
    if (!viewing || !record.iframeUrl || !workspace) return record
    return { ...record, iframeUrl: url }
  }, [viewing, record, workspace, url])
  return { frame, probe }
}

function previewKey(sandboxName: string, devPort: number): string {
  return `${sandboxName}:${devPort}`
}
