"use client"

import { useState } from "react"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { FileImageIcon } from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"
import { attachmentUrl } from "@/lib/chat-attachments"
import { isWebImageSource } from "@/lib/document-image"
import { useRoomId } from "@/lib/yjs/context"

/**
 * A Document image (`lib/document-image.ts`) in the editor. Its `src` is a
 * canvas file path, shown through the members-only files route; a file that's
 * gone (deleted, or moved by an agent) leaves a quiet row naming it.
 */
export function DocumentImageNodeView({ node, selected }: NodeViewProps) {
  const roomId = useRoomId()
  const src = (node.attrs.src as string | null) ?? ""
  const alt = (node.attrs.alt as string | null) ?? ""
  const url = isWebImageSource(src) ? src : attachmentUrl(roomId, src)
  // Keyed by the URL, so a fixed path tries again.
  const [failed, setFailed] = useState<string | null>(null)

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
          onError={() => setFailed(url)}
          className={cn(
            "m-0 block max-w-full rounded-md",
            selected && "outline-2 outline-offset-2 outline-ring"
          )}
        />
      )}
    </NodeViewWrapper>
  )
}
