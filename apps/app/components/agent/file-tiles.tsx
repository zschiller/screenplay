"use client"

import { createContext, useContext, useMemo, useRef } from "react"
import { Button } from "@workspace/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  DotsThreeIcon,
  FileTextIcon,
  FolderIcon,
  PlusSquareIcon,
  ScribbleIcon,
} from "@workspace/ui/components/icons"
import { cn } from "@workspace/ui/lib/utils"
import { DocumentPreview, MockupPreview } from "@/components/agent/file-preview"
import { FILE_DRAG_TYPE, fileDrag } from "@/lib/canvas/file-drag"
import { fileModal } from "@/lib/canvas/file-modal"
import { useOptionalYjs } from "@/lib/yjs/context"
import {
  useLayerFiles,
  useMarkdownLayers,
  useMockupLayers,
} from "@/lib/yjs/react"
import type { LayerFileData, LayerFileKind } from "@/lib/types"

/** The icon each kind of file shows beside its name, as its mentions do. */
export const FILE_KIND_ICON: Record<LayerFileKind, typeof FileTextIcon> = {
  document: FileTextIcon,
  mockup: ScribbleIcon,
}

/**
 * What a tile's ⋯ menu does on the canvas it's in (#1887). Outside a canvas
 * there's none, and tiles have no menu and don't drag.
 */
export type FileTileActions = {
  /** Put a view on the canvas, as the file modal's Add to canvas does. */
  addToCanvas: (fileId: string) => void
  /** Open Canvas settings › Files at the file. */
  showInFiles: (fileId: string) => void
}

export const FileTileActionsContext = createContext<FileTileActions | null>(
  null
)

/**
 * The Documents and Mockups a reply delivered (#1885, spec #1882), as square
 * tiles two to a row under its answer: the file's preview on top, its kind
 * icon and name in a row under it, inside a 1px border with square corners.
 * Nothing else at rest. A click opens the file in the modal. On hover a ⋯
 * covers the end of the name row (#1887) with Add to canvas and Show in Files,
 * and a tile dragged onto the canvas puts a view where it's dropped. `ids`
 * name views or files; each file shows once, and one that's gone shows
 * nothing.
 */
export function FileTiles({ ids }: { ids: string[] }) {
  // A transcript outside a room (tests, a read-only view) has no files.
  if (!useOptionalYjs()) return null
  return <RoomFileTiles ids={ids} />
}

function RoomFileTiles({ ids }: { ids: string[] }) {
  const files = useLayerFiles()
  const documents = useMarkdownLayers()
  const mockups = useMockupLayers()
  const shown = useMemo(() => {
    const out: LayerFileData[] = []
    for (const id of ids) {
      const view =
        documents.find((v) => v.id === id) ?? mockups.find((v) => v.id === id)
      const file = files.find((f) => f.id === (view?.fileId ?? id))
      if (file && !out.includes(file)) out.push(file)
    }
    return out
  }, [ids, files, documents, mockups])
  if (shown.length === 0) return null
  return (
    <div data-testid="file-tiles" className="grid grid-cols-2 gap-2">
      {shown.map((file) => (
        <FileTile key={file.id} file={file} />
      ))}
    </div>
  )
}

function FileTile({ file }: { file: LayerFileData }) {
  const actions = useContext(FileTileActionsContext)
  const tileRef = useRef<HTMLDivElement>(null)
  const Icon = FILE_KIND_ICON[file.kind]
  const name =
    file.title || (file.kind === "mockup" ? "Untitled mockup" : "Untitled")
  const Preview = file.kind === "mockup" ? MockupPreview : DocumentPreview
  return (
    <div
      ref={tileRef}
      data-testid="file-tile"
      data-file-id={file.id}
      className="group/file-tile relative flex min-w-0 flex-col border border-border bg-background hover:border-foreground/30 has-[[aria-expanded=true]]:border-foreground/30"
    >
      <Preview
        fileId={file.id}
        title={file.title}
        className="aspect-[5/4] w-full shrink-0 border-b border-border"
      />
      <span
        className={cn(
          "relative flex min-w-0 items-start gap-2 px-3 py-2 text-sm",
          // Touch screens always show the ⋯, so there the name keeps room
          // for it, as the rows do.
          actions && "pr-10 md:pr-3"
        )}
      >
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span data-slot="file-tile-name" className="min-w-0 break-words">
          {name}
        </span>
        {actions && <FileTileMenu fileId={file.id} actions={actions} />}
      </span>
      {/* The whole tile opens the file: one button laid over it, under the
          ⋯ (which stacks above it), so the menu isn't a button inside a
          button. */}
      <button
        type="button"
        aria-label={name}
        className="absolute inset-0 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        onClick={() => fileModal.open(file.id)}
        draggable={!!actions}
        onDragStart={(e) => {
          e.dataTransfer.setData(FILE_DRAG_TYPE, file.id)
          e.dataTransfer.effectAllowed = "copy"
          // The button is see-through; drag the tile's picture.
          const tile = tileRef.current
          if (tile) {
            const box = tile.getBoundingClientRect()
            e.dataTransfer.setDragImage(
              tile,
              e.clientX - box.left,
              e.clientY - box.top
            )
          }
          fileDrag.start(file.id)
        }}
        onDragEnd={() => fileDrag.end()}
      />
    </div>
  )
}

/**
 * The tile's ⋯ (#1887): over the end of the name row on hover, keyboard
 * focus and while its menu is open, fading the name in from the left over
 * 16px as the rows' ⋯ does, and reserving nothing at rest. No Open: a click
 * on the tile opens it.
 */
function FileTileMenu({
  fileId,
  actions,
}: {
  fileId: string
  actions: FileTileActions
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="More"
          className="absolute top-1 right-1 z-10 rounded-none bg-background group-hover/file-tile:opacity-100 before:pointer-events-none before:absolute before:inset-y-0 before:-left-4 before:w-4 before:bg-gradient-to-r before:from-transparent before:to-background focus-visible:opacity-100 aria-expanded:opacity-100 md:opacity-0 dark:hover:bg-muted dark:aria-expanded:bg-muted"
        >
          <DotsThreeIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => actions.addToCanvas(fileId)}>
          <PlusSquareIcon />
          Add to canvas
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => actions.showInFiles(fileId)}>
          <FolderIcon />
          Show in Files
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
