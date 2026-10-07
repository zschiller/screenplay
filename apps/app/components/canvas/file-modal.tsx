"use client"

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { useTheme } from "next-themes"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  DotsThreeIcon,
  PlusSquareIcon,
  XIcon,
} from "@workspace/ui/components/icons"
import { ChatMarkdown } from "@/components/agent/chat-markdown"
import {
  useDocumentBody,
  useMockupSrcDoc,
} from "@/components/agent/file-preview"
import { FILE_KIND_ICON } from "@/components/agent/file-tiles"
import {
  LivePageContent,
  useLivePage,
  type LivePageWrites,
} from "@/components/canvas/live-page"
import {
  useMockupChatLink,
  useMockupPageChat,
  useMockupQuestion,
} from "@/components/canvas/mockup-chat-link"
import { useMockupPageTheme } from "@/hooks/use-mockup-page-theme"
import { fileModal } from "@/lib/canvas/file-modal"
import type { CanvasOps } from "@/lib/canvas/ops"
import { useLayerFile, type ShownLayerFile } from "@/lib/yjs/react"

const KIND_LABEL = { document: "Document", mockup: "Mockup" } as const

const NOBODY_DRIVES = { kind: "none" } as const

/**
 * The file modal (#1885, spec #1882): a Document or Mockup at 100%, its UI
 * scale whatever the canvas zoom, under one title row with the kind icon, the
 * name in the title font, ⋯ and close. A Mockup's page keeps running, so its
 * knobs, links and picks work; a Document reads as it does on the canvas.
 * ⋯ › Add to canvas closes it and puts a view on the canvas. Opened from a
 * tile in a chat reply, a double-click on a view, or a mention of a file with
 * no view (`lib/canvas/file-modal.ts`).
 */
export function FileModal({
  ops,
  onAddToCanvas,
}: {
  ops: CanvasOps
  /** Put a view of the file on the canvas, selected, the camera following. */
  onAddToCanvas: (fileId: string) => void
}) {
  const openId = useSyncExternalStore(
    fileModal.subscribe,
    fileModal.current,
    () => null
  )
  const file = useLayerFile(openId)
  // A file deleted while it's open closes the modal.
  useEffect(() => {
    if (openId && !file) fileModal.close()
  }, [openId, file])
  return (
    <Dialog
      open={!!file}
      onOpenChange={(open) => {
        if (!open) fileModal.close()
      }}
    >
      {file && (
        <DialogContent
          showCloseButton={false}
          data-testid="file-modal"
          className="flex h-[calc(100dvh-4rem)] w-[calc(100vw-4rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(90rem,calc(100vw-4rem))]"
        >
          <FileModalHeader
            file={file}
            onAddToCanvas={() => {
              fileModal.close()
              onAddToCanvas(file.id)
            }}
          />
          <div className="relative min-h-0 flex-1">
            {file.kind === "mockup" ? (
              <ModalMockupPage file={file} ops={ops} />
            ) : (
              <ModalDocument file={file} />
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  )
}

function FileModalHeader({
  file,
  onAddToCanvas,
}: {
  file: ShownLayerFile
  onAddToCanvas: () => void
}) {
  const Icon = FILE_KIND_ICON[file.kind]
  return (
    <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-border py-3 pr-4 pl-5">
      <Icon aria-hidden className="size-5 shrink-0" />
      <DialogTitle className="min-w-0 flex-1 break-words">
        {file.title || "Untitled"}
      </DialogTitle>
      <DialogDescription className="sr-only">
        {KIND_LABEL[file.kind]}
      </DialogDescription>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More">
            <DotsThreeIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onAddToCanvas}>
            <PlusSquareIcon />
            Add to canvas
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DialogClose asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Close">
          <XIcon />
        </Button>
      </DialogClose>
    </div>
  )
}

/** The box's size, following its resizes; zero until measured. */
function useBoxSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () =>
      setSize({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/**
 * A Mockup's page at 100%, running: the same Live Page its views use, laid out
 * at the modal's size and taking the pointer, its knobs and shared state
 * written to the file as a view's are, and its drafts and answers speaking to
 * the Mockup's chat as a view's do while someone interacts with it.
 */
function ModalMockupPage({
  file,
  ops,
}: {
  file: ShownLayerFile
  ops: CanvasOps
}) {
  const srcDoc = useMockupSrcDoc(file.id)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const { width, height } = useBoxSize(bodyRef)
  const fileId = file.id
  const writes = useMemo<LivePageWrites>(
    () => ({
      knobsDeclared: (_id, knobs) => {
        const current = ops.fileOf(fileId)
        if (JSON.stringify(current?.knobs ?? []) === JSON.stringify(knobs))
          return
        ops.patch("layerFiles", fileId, { knobs })
      },
      knobValues: (_id, knobValues) =>
        ops.patch("layerFiles", fileId, { knobValues }),
      sharedState: (_id, sharedState) =>
        ops.patch("layerFiles", fileId, { sharedState }),
    }),
    [ops, fileId]
  )
  const page = useLivePage({
    // Its own id: the views on the canvas register theirs with the drive.
    id: `file-modal-${fileId}`,
    source: { kind: "srcdoc", srcDoc, title: file.title || "Mockup" },
    record: file,
    writes,
    interactive: true,
    driver: NOBODY_DRIVES,
    zoom: 1,
    width,
    height,
    iframeRef,
    bodyRef,
  })
  // The page speaks to the Mockup's chat by a view's id, as a view does, or
  // by the file's when it has none.
  const linkId = file.viewIds[0] ?? fileId
  const link = useMockupChatLink()
  const question = useMockupQuestion(link, linkId)
  const { resolvedTheme } = useTheme()
  useMockupPageTheme(
    page.port,
    resolvedTheme ? (resolvedTheme === "dark" ? "dark" : "light") : null
  )
  useMockupPageChat(page.port, {
    question,
    answerable: true,
    onDraft: link ? (text) => link.draft(linkId, text) : undefined,
    onAnswer: link ? (found, index) => link.answer(found, index) : undefined,
  })
  return (
    <div ref={bodyRef} className="absolute inset-0 overflow-hidden bg-white">
      {width > 0 && <LivePageContent page={page} iframeRef={iframeRef} />}
    </div>
  )
}

/** A Document as it reads, in a readable column. */
function ModalDocument({ file }: { file: ShownLayerFile }) {
  const body = useDocumentBody(file.id)
  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-8 py-6 [&_.chat-markdown>:first-child]:mt-0">
        <ChatMarkdown size="prose">{body}</ChatMarkdown>
      </div>
    </div>
  )
}
