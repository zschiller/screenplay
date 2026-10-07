"use client"

import { useMemo } from "react"
import { FileTextIcon, ScribbleIcon } from "@workspace/ui/components/icons"
import { DocumentPreview, MockupPreview } from "@/components/agent/file-preview"
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
 * The Documents and Mockups a reply delivered (#1885, spec #1882), as square
 * tiles two to a row under its answer: the file's preview on top, its kind
 * icon and name in a row under it, inside a 1px border with square corners.
 * Nothing else at rest. A click opens the file in the modal. `ids` name views
 * or files; each file shows once, and one that's gone shows nothing.
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
  const Icon = FILE_KIND_ICON[file.kind]
  const name =
    file.title || (file.kind === "mockup" ? "Untitled mockup" : "Untitled")
  const Preview = file.kind === "mockup" ? MockupPreview : DocumentPreview
  return (
    <button
      type="button"
      data-testid="file-tile"
      data-file-id={file.id}
      className="flex min-w-0 flex-col border border-border bg-background text-left outline-none hover:border-foreground/30 focus-visible:ring-2 focus-visible:ring-ring/50"
      onClick={() => fileModal.open(file.id)}
    >
      <Preview
        fileId={file.id}
        title={file.title}
        className="aspect-[5/4] w-full shrink-0 border-b border-border"
      />
      <span className="flex min-w-0 items-start gap-2 px-3 py-2 text-sm">
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span data-slot="file-tile-name" className="min-w-0 break-words">
          {name}
        </span>
      </span>
    </button>
  )
}
