"use client"

import { useEffect, useState } from "react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@workspace/ui/components/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { Spinner } from "@workspace/ui/components/spinner"
import {
  ListScrollHairline,
  PICKER_DIALOG_CLASS,
  PICKER_DIALOG_HEADER_CLASS,
} from "@/components/picker-dialog"
import { accountFileUrl } from "@/components/canvas/canvas-files-section"
import { withBasePath } from "@/lib/base-path"
import { attachmentUrl } from "@/lib/chat-attachments"
import { MODEL_IMAGE_TYPES } from "@/lib/files/attachments"
import { baseName, parentPath } from "@/lib/files/paths"
import type { FileEntryData } from "@/lib/types"

/** A file picked for a Document image, and whose Files it's in. */
export interface PickedImage {
  scope: "canvas" | "account"
  path: string
}

const imagesIn = (entries: FileEntryData[]) =>
  entries
    .filter((e) => e.kind === "file" && MODEL_IMAGE_TYPES.has(e.mediaType))
    .sort((a, b) => b.updatedAt - a.updatedAt)

/**
 * Image from files, from a Document's `/` menu: the images in the canvas's
 * files and in your account's, newest first, in the app's searchable picker.
 * Picking one closes it; an account image is copied into the canvas's files,
 * so everyone on the canvas can see it.
 */
export function DocumentImagePicker({
  open,
  onOpenChange,
  roomId,
  canvasFiles,
  listAccountFiles,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  roomId: string
  canvasFiles: FileEntryData[]
  /** Your account's files, fetched each time the picker opens. */
  listAccountFiles: () => Promise<FileEntryData[]>
  onPick: (image: PickedImage) => void
}) {
  const [account, setAccount] = useState<FileEntryData[] | null>(null)
  const [listScrolled, setListScrolled] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    listAccountFiles()
      .then((entries) => !cancelled && setAccount(entries))
      // Without them the canvas's images still show.
      .catch(() => !cancelled && setAccount([]))
    return () => {
      cancelled = true
      setAccount(null)
    }
  }, [open, listAccountFiles])

  const canvasImages = imagesIn(canvasFiles)
  const accountImages = account ? imagesIn(account) : []
  const none = account !== null && !canvasImages.length && !accountImages.length

  const pick = (image: PickedImage) => {
    onPick(image)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={PICKER_DIALOG_CLASS}
        data-document-image-picker=""
      >
        <DialogHeader className={PICKER_DIALOG_HEADER_CLASS}>
          <DialogTitle>Image from files</DialogTitle>
          <DialogDescription>
            Images saved in this canvas’s files and your account’s.
          </DialogDescription>
        </DialogHeader>
        <Command>
          <CommandInput
            placeholder="Search images"
            onValueChange={() => setListScrolled(false)}
          />
          <div className="relative min-h-0 flex-1">
            <ListScrollHairline shown={listScrolled} />
            <CommandList
              className="pb-4"
              onScroll={(e) => setListScrolled(e.currentTarget.scrollTop > 0)}
            >
              {none ? (
                <div className="px-1 py-8 text-center text-sm text-muted-foreground">
                  No images in files yet. Paste or drop one into the document to
                  add it.
                </div>
              ) : (
                <CommandEmpty>No images found.</CommandEmpty>
              )}
              {canvasImages.length > 0 && (
                <CommandGroup heading="Canvas">
                  {canvasImages.map((entry) => (
                    <ImageItem
                      key={entry.id}
                      entry={entry}
                      value={`canvas:${entry.path}`}
                      url={attachmentUrl(roomId, entry.path)}
                      onSelect={() =>
                        pick({ scope: "canvas", path: entry.path })
                      }
                    />
                  ))}
                </CommandGroup>
              )}
              {accountImages.length > 0 && (
                <CommandGroup heading="Account">
                  {accountImages.map((entry) => (
                    <ImageItem
                      key={entry.id}
                      entry={entry}
                      value={`account:${entry.path}`}
                      url={withBasePath(accountFileUrl(entry.path))}
                      onSelect={() =>
                        pick({ scope: "account", path: entry.path })
                      }
                    />
                  ))}
                </CommandGroup>
              )}
              {account === null && (
                <div
                  role="status"
                  className="flex items-center justify-center gap-2 py-4"
                >
                  <Spinner className="size-4 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">
                    Loading your files…
                  </span>
                </div>
              )}
            </CommandList>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}

/** One image: a small thumbnail, its name, and the folder it's in. */
function ImageItem({
  entry,
  value,
  url,
  onSelect,
}: {
  entry: FileEntryData
  value: string
  url: string
  onSelect: () => void
}) {
  const folder = parentPath(entry.path)
  return (
    <CommandItem value={value} keywords={[entry.path]} onSelect={onSelect}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a private file behind a members-only route */}
      <img
        src={url}
        alt=""
        loading="lazy"
        className="size-8 shrink-0 rounded-sm bg-muted object-cover"
      />
      <span className="truncate">{baseName(entry.path)}</span>
      {folder && (
        <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
          {folder}
        </span>
      )}
    </CommandItem>
  )
}
