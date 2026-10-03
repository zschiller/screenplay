"use client"

import { useEffect, useState } from "react"
import {
  CaretRightIcon,
  DotsThreeIcon,
  DownloadSimpleIcon,
  FileIcon,
  FileImageIcon,
  FilePdfIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  TrashIcon,
  ArrowSquareOutIcon,
} from "@workspace/ui/components/icons"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@workspace/ui/components/sidebar"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Spinner } from "@workspace/ui/components/spinner"
import { cn } from "@workspace/ui/lib/utils"
import { toast } from "sonner"
import { ConfirmDialog } from "@/components/confirm-dialog"
import { LoadErrorState } from "@/components/home/load-error"
import { baseName, formatFileSize, isTextMediaType } from "@/lib/files/paths"
import { fileTree, itemCount, type FileTreeNode } from "@/lib/files/tree"
import type { FileEntryData } from "@/lib/types"

/** Where a canvas's file is read and deleted: the route that checks membership. */
export function canvasFileUrl(roomId: string, path: string): string {
  const encoded = path.split("/").map(encodeURIComponent).join("/")
  return `/api/canvas-files/${encodeURIComponent(roomId)}/${encoded}`
}

/** Delete a file, or a folder with everything in it, for every member. */
export async function deleteCanvasFile(
  roomId: string,
  path: string
): Promise<void> {
  const res = await fetch(canvasFileUrl(roomId, path), { method: "DELETE" })
  if (!res.ok) throw new Error("Couldn’t delete it. Try again.")
}

/** A row's muted meta: "880 KB · Saved by agent". */
export function fileDetail(
  entry: FileEntryData,
  adderName: (entry: FileEntryData) => string
): string {
  return `${formatFileSize(entry.size)} · ${adderName(entry)}`
}

/**
 * Canvas settings › Files (#1517): the canvas's files as one expanding tree,
 * read-only for people. Agents save and organize files; a person can open one
 * ({@link CanvasFileDialog}, over Canvas settings, as Repositories' Edit is)
 * or delete a file or folder for every member, after a confirm.
 *
 * On the desktop the files are on the Mac, so Open hands a file to its own
 * app and Reveal in Finder shows a file or folder there (`onDesktop`).
 */
export function FilesSection({
  roomId,
  files,
  onDelete,
  onDesktop,
  adderName,
}: {
  roomId: string
  files: FileEntryData[]
  onDelete: (path: string) => Promise<void>
  /** The desktop's Open and Reveal in Finder; absent on hosted. */
  onDesktop?: (path: string, how: "open" | "reveal") => Promise<void>
  /** "Saved by agent", "Added by you", "Added by Sam". */
  adderName: (entry: FileEntryData) => string
}) {
  const [deleting, setDeleting] = useState<FileTreeNode | null>(null)
  // The folders open in the tree, by path.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set())
  // The file open in its dialog; gone if an agent deletes or moves it.
  const [openPath, setOpenPath] = useState<string | null>(null)
  const opened = files.find((f) => f.path === openPath && f.kind === "file")
  const tree = fileTree(files)
  const onToggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const desktop = (node: FileTreeNode, how: "open" | "reveal") =>
    onDesktop?.(node.entry.path, how).catch(() =>
      toast.error(
        how === "open"
          ? `Couldn't open ${node.name}.`
          : `Couldn't show ${node.name} in Finder.`
      )
    )

  const branch = (nodes: FileTreeNode[]) =>
    nodes.map((node) => (
      <FileRow
        key={node.entry.path}
        node={node}
        open={expanded.has(node.entry.path)}
        detail={
          node.entry.kind === "folder"
            ? itemCount(node.children.length)
            : fileDetail(node.entry, adderName)
        }
        onToggle={() => onToggle(node.entry.path)}
        onOpen={() =>
          onDesktop ? desktop(node, "open") : setOpenPath(node.entry.path)
        }
        onReveal={onDesktop && (() => desktop(node, "reveal"))}
        onDelete={() => setDeleting(node)}
      >
        {node.children.length > 0 && branch(node.children)}
      </FileRow>
    ))

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Files every chat on this canvas can open. Agents save and organize them.
      </p>
      {tree.length === 0 ? (
        <Empty className="flex-none border py-8">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FolderIcon />
            </EmptyMedia>
            <EmptyTitle>No files yet</EmptyTitle>
            <EmptyDescription>
              Ask a chat to save a file here, and every chat on this canvas can
              open it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        // The canvas sidebar's layer tree: compact rows, nested lists
        // indented on a guide line. Pulled left so icons line up with the
        // description's text.
        <SidebarMenu aria-label="Files" className="-mx-2 w-auto">
          {branch(tree)}
        </SidebarMenu>
      )}
      <CanvasFileDialog
        roomId={roomId}
        entry={opened}
        detail={opened ? fileDetail(opened, adderName) : ""}
        onOpenChange={(open) => {
          if (!open) setOpenPath(null)
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        verb="Delete"
        itemName={deleting?.name}
        itemNoun={deleting?.entry.kind ?? "file"}
        description={deleting ? deleteDescription(deleting) : null}
        onConfirm={async () => {
          if (!deleting) return
          await onDelete(deleting.entry.path)
          setDeleting(null)
        }}
      />
    </>
  )
}

/** What Delete does, with a folder's blast radius. */
export function deleteDescription(node: FileTreeNode): string {
  if (node.entry.kind === "file") {
    return "Chats on this canvas can no longer open it. You can’t undo this."
  }
  if (node.descendants === 0) {
    return "The folder is empty. You can’t undo this."
  }
  return node.descendants === 1
    ? "The 1 item in it goes too, and chats on this canvas can no longer open it. You can’t undo this."
    : `The ${node.descendants} items in it go too, and chats on this canvas can no longer open them. You can’t undo this.`
}

/**
 * One row of the tree, built like the canvas sidebar's layer rows: a
 * folder's icon turns into its chevron on hover, its contents nest on a guide
 * line, and the ⋯ menu shows on hover.
 */
function FileRow({
  node,
  open,
  detail,
  onToggle,
  onOpen,
  onReveal,
  onDelete,
  children,
}: {
  node: FileTreeNode
  open: boolean
  detail: string
  onToggle: () => void
  onOpen: () => void
  /** Desktop only: show the file or folder in Finder. */
  onReveal?: () => void
  onDelete: () => void
  children?: React.ReactNode
}) {
  const { entry, name } = node
  const folder = entry.kind === "folder"
  const [menuOpen, setMenuOpen] = useState(false)
  const row = (
    <div className="group/file-row relative">
      <SidebarMenuButton
        aria-expanded={folder ? open : undefined}
        onClick={folder ? onToggle : onOpen}
        // The ⋯ shows over the row's end on hover, as in the Chats menu, so
        // the meta runs to the edge instead of leaving room for it.
        className={cn(
          "md:group-has-data-[sidebar=menu-action]/menu-item:pr-2",
          menuOpen && "bg-sidebar-accent text-sidebar-accent-foreground"
        )}
      >
        {folder ? (
          <span className="relative shrink-0">
            {open ? (
              <FolderOpenIcon className="block text-sidebar-foreground/70 group-hover/file-row:hidden" />
            ) : (
              <FolderIcon className="block text-sidebar-foreground/70 group-hover/file-row:hidden" />
            )}
            <CaretRightIcon
              className={cn(
                "hidden text-sidebar-foreground/70 transition-transform group-hover/file-row:block",
                open && "rotate-90"
              )}
            />
          </span>
        ) : (
          <EntryIcon entry={entry} />
        )}
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>
      </SidebarMenuButton>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <SidebarMenuAction
            // Shown on this row's own hover: an item holds its folder's
            // contents, so the stock menu-item hover would light up every
            // folder above the pointer too. It covers the meta's end on the
            // hovered row's fill, fading in from the left (on touch screens, where
            // it always shows, the row keeps room for it).
            className="group-hover/file-row:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 md:bg-sidebar-accent md:opacity-0 md:before:pointer-events-none md:before:absolute md:before:inset-y-0 md:before:-left-4 md:before:w-4 md:before:bg-gradient-to-r md:before:from-transparent md:before:to-sidebar-accent"
            aria-label={`More actions for ${name}`}
          >
            <DotsThreeIcon />
          </SidebarMenuAction>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {!folder && (
            <DropdownMenuItem onSelect={onOpen}>
              <ArrowSquareOutIcon />
              Open
            </DropdownMenuItem>
          )}
          {onReveal && (
            <DropdownMenuItem onSelect={onReveal}>
              <FolderOpenIcon />
              Reveal in Finder
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onSelect={onDelete}>
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
  return (
    <SidebarMenuItem>
      {row}
      {folder && open && children && (
        // No stock 1px nudge: it adds up level by level and staggers the
        // right-aligned sizes. The margin keeps the guide under the icon.
        <SidebarMenuSub className="ml-[15px] translate-x-0">
          {children}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  )
}

function EntryIcon({ entry }: { entry: FileEntryData }) {
  const className = "text-sidebar-foreground/70"
  if (entry.kind === "folder")
    return <FolderIcon aria-hidden className={className} />
  if (entry.mediaType === "application/pdf")
    return <FilePdfIcon aria-hidden className={className} />
  if (entry.mediaType.startsWith("image/"))
    return <FileImageIcon aria-hidden className={className} />
  if (isTextMediaType(entry.mediaType))
    return <FileTextIcon aria-hidden className={className} />
  return <FileIcon aria-hidden className={className} />
}

/** The most text shown; past it, the file is a download. */
const TEXT_SHOWN_MAX = 200_000

type Loaded =
  | { state: "loading" }
  | { state: "text"; text: string; cut: boolean }
  | { state: "error" }

/**
 * An opened file (#1517), in a dialog over Canvas settings: an image or PDF as
 * the browser draws it, text as source, and anything else as a download.
 */
export function CanvasFileDialog({
  roomId,
  entry,
  detail,
  onOpenChange,
}: {
  roomId: string
  /** The open file; none closes the dialog. */
  entry: FileEntryData | undefined
  detail: string
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={entry !== undefined} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(640px,85vh)] flex-col sm:max-w-2xl">
        {entry && (
          <>
            <DialogHeader className="min-w-0 pr-8">
              <DialogTitle className="truncate">
                {baseName(entry.path)}
              </DialogTitle>
              <DialogDescription>{detail}</DialogDescription>
            </DialogHeader>
            <FileBody roomId={roomId} entry={entry} />
            <DialogFooter>
              <Button asChild variant="outline">
                <a
                  href={canvasFileUrl(roomId, entry.path)}
                  download={baseName(entry.path)}
                >
                  <DownloadSimpleIcon />
                  Download
                </a>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function FileBody({ roomId, entry }: { roomId: string; entry: FileEntryData }) {
  const url = canvasFileUrl(roomId, entry.path)
  // An SVG is drawn as an image (no script runs in an <img>), not as source.
  if (entry.mediaType.startsWith("image/")) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg border p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- a private
            route's bytes, not an optimizable asset */}
        <img
          src={url}
          alt={entry.path}
          className="max-h-full max-w-full object-contain"
        />
      </div>
    )
  }
  if (entry.mediaType === "application/pdf") {
    return (
      <iframe
        src={url}
        title={entry.path}
        className="min-h-0 w-full flex-1 rounded-lg border"
      />
    )
  }
  if (isTextMediaType(entry.mediaType)) {
    return <TextFile url={url} name={entry.path} updatedAt={entry.updatedAt} />
  }
  return (
    <Empty className="flex-1 border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileIcon />
        </EmptyMedia>
        <EmptyTitle>No preview for this file</EmptyTitle>
        <EmptyDescription>
          Download it to open it on your computer.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function TextFile({
  url,
  name,
  updatedAt,
}: {
  url: string
  name: string
  /** Read again when an agent saves over the file. */
  updatedAt: number
}) {
  const [attempt, setAttempt] = useState(0)
  // What was read, and for which version of the file; a newer version (or a
  // retry) reads as loading until its own read lands.
  const key = `${url}#${updatedAt}#${attempt}`
  const [result, setResult] = useState<{ key: string; loaded: Loaded }>()
  const loaded: Loaded =
    result?.key === key ? result.loaded : { state: "loading" }

  useEffect(() => {
    let cancelled = false
    const setLoaded = (next: Loaded) => setResult({ key, loaded: next })
    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const text = await res.text()
        if (!cancelled) {
          setLoaded({
            state: "text",
            text: text.slice(0, TEXT_SHOWN_MAX),
            cut: text.length > TEXT_SHOWN_MAX,
          })
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded({ state: "error" })
      })
    return () => {
      cancelled = true
    }
  }, [url, key])

  if (loaded.state === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center rounded-lg border">
        <Spinner aria-label={`Opening ${name}`} />
      </div>
    )
  }
  if (loaded.state === "error") {
    return (
      <LoadErrorState
        title="Couldn’t open this file"
        description="Something went wrong. Try again."
        onRetry={async () => setAttempt((n) => n + 1)}
      />
    )
  }
  return (
    <pre
      aria-label={name}
      className="min-h-0 flex-1 overflow-auto rounded-lg border p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
    >
      {loaded.text}
      {loaded.cut && (
        <span className="mt-3 block font-sans text-muted-foreground">
          Showing the start of the file. Download it for the rest.
        </span>
      )}
    </pre>
  )
}
