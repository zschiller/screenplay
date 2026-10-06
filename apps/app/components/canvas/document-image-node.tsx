"use client"

import { useEffect, useState } from "react"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { FileImageIcon } from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"
import { attachmentUrl } from "@/lib/chat-attachments"
import { isWebImageSource } from "@/lib/document-image"
import { fetchPngDensity, imageDensity } from "@/lib/image-density"
import { useRoomId } from "@/lib/yjs/context"

/**
 * A Document image (`lib/document-image.ts`) in the editor. Its `src` is a
 * canvas file path, shown through the members-only files route; a file that's
 * gone (deleted, or moved by an agent) leaves a quiet row naming it.
 *
 * It shows at its pixel density (`lib/image-density.ts`), so a retina
 * screenshot is the size it was on screen, never wider than the column. It
 * stays hidden until both its size and its PNG hint are in, so it doesn't
 * show big and then shrink.
 */
export function DocumentImageNodeView({ node, selected }: NodeViewProps) {
  const roomId = useRoomId()
  const src = (node.attrs.src as string | null) ?? ""
  const alt = (node.attrs.alt as string | null) ?? ""
  const url = isWebImageSource(src) ? src : attachmentUrl(roomId, src)
  // Keyed by the URL, so a fixed path tries again.
  const [failed, setFailed] = useState<string | null>(null)
  const [naturalWidth, setNaturalWidth] = useState<{
    url: string
    width: number
  } | null>(null)
  const [png, setPng] = useState<{
    url: string
    density: number | null
  } | null>(null)
  useEffect(() => {
    if (!src) return
    let live = true
    void fetchPngDensity(url).then((density) => {
      if (live) setPng({ url, density })
    })
    return () => {
      live = false
    }
  }, [url, src])
  const width =
    naturalWidth?.url === url && png?.url === url
      ? naturalWidth.width /
        imageDensity({
          src,
          naturalWidth: naturalWidth.width,
          png: png.density,
        })
      : null

  return (
    <NodeViewWrapper
      className="my-3 w-fit max-w-full"
      data-document-image=""
      data-drag-handle=""
    >
      {failed === url || !src ? (
        <div
          className={cn(
            "flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground",
            selected && "outline-2 outline-offset-2 outline-ring"
          )}
        >
          <FileImageIcon className="size-4 shrink-0" />
          <span className="truncate">
            {src ? `${src} isn’t in Files any more` : "No image"}
          </span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- a private file behind the members-only route; next/image can't fetch it
        <img
          src={url}
          alt={alt}
          draggable={false}
          onLoad={(event) =>
            setNaturalWidth({ url, width: event.currentTarget.naturalWidth })
          }
          onError={() => setFailed(url)}
          style={width === null ? undefined : { width }}
          className={cn(
            "m-0 block max-w-full rounded-md",
            width === null && "invisible h-0",
            selected && "outline-2 outline-offset-2 outline-ring"
          )}
        />
      )}
    </NodeViewWrapper>
  )
}
