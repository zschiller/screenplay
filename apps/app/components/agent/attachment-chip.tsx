"use client"

import {
  FileCodeIcon,
  FileImageIcon,
  FilePdfIcon,
  FileTextIcon,
  XIcon,
} from "@workspace/ui/components/icons"
import { IconButton } from "@workspace/ui/components/icon-button"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import { getTauriInvoke } from "@/lib/desktop/tauri-bridge"
import { openExternal } from "@/lib/open-external"
import { baseName, isTextMediaType } from "@/lib/files/paths"

/**
 * A file attached to a chat message (#1525): its type's icon and its name.
 * In the composer it can be taken out again, and spins while it uploads; on
 * a sent message it opens the file.
 */

/** The file glyph for an attachment's media type. */
function AttachmentIcon({ mediaType }: { mediaType?: string }) {
  const className = "size-3.5 shrink-0 text-muted-foreground"
  if (mediaType?.startsWith("image/") && mediaType !== "image/svg+xml")
    return <FileImageIcon className={className} />
  if (mediaType === "application/pdf")
    return <FilePdfIcon className={className} />
  if (
    mediaType &&
    isTextMediaType(mediaType) &&
    !mediaType.startsWith("text/plain") &&
    !mediaType.startsWith("text/markdown")
  )
    return <FileCodeIcon className={className} />
  return <FileTextIcon className={className} />
}

const CHIP =
  "inline-flex h-7 max-w-56 min-w-0 items-center gap-1.5 rounded-lg text-sm"

/** An attachment in the composer, before the message is sent. */
export function ComposerAttachmentChip({
  name,
  mediaType,
  uploading,
  onRemove,
}: {
  name: string
  mediaType?: string
  uploading?: boolean
  onRemove: () => void
}) {
  return (
    <div
      data-testid="composer-attachment"
      className={cn(CHIP, "bg-muted/60 pl-2.5 dark:bg-input/50")}
    >
      {uploading ? (
        <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <AttachmentIcon mediaType={mediaType} />
      )}
      <span className="truncate">{name}</span>
      <IconButton label={`Remove ${name}`} onClick={onRemove}>
        <XIcon />
      </IconButton>
    </div>
  )
}

/** An attachment on a sent message: opens the file. */
export function SentAttachmentChip({
  path,
  mediaType,
  href,
}: {
  path: string
  mediaType: string
  href: string
}) {
  const name = baseName(path)
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={path}
      data-testid="message-attachment"
      onClick={(e) => {
        // The desktop webview opens no new windows: hand it to the OS.
        if (!getTauriInvoke()) return
        e.preventDefault()
        openExternal(href)
      }}
      className={cn(
        CHIP,
        "bg-muted px-2.5 outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/70 dark:hover:bg-input"
      )}
    >
      <AttachmentIcon mediaType={mediaType} />
      <span className="truncate">{name}</span>
    </a>
  )
}
