"use client"

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@workspace/ui/components/hover-card"
import { Button } from "@workspace/ui/components/button"
import { useChatsMenu } from "@/components/agent/chats-menu"
import { ChatMarkdown } from "@/components/agent/chat-markdown"
import { WORKSPACE_HOVER_CARD_DELAY_MS } from "@/components/workspace-hover-card"
import { useMockupRefs } from "@/hooks/use-mockup-refs"
import { useMockupRuntime } from "@/hooks/use-mockup-runtime"
import { lastChangedBy, layerChat } from "@/lib/canvas/layer-chat"
import { readDocumentBody } from "@/lib/document-markdown"
import { getRoomThumbnailManifest } from "@/lib/rooms-actions"
import { useRoomId, useYjs } from "@/lib/yjs/context"
import { documentFragment } from "@/lib/yjs/fragment-text"
import { mockupSrcDoc } from "@/lib/yjs/mockup-html"
import {
  useBranches,
  useChatSessions,
  useIframeLayers,
  useMarkdownLayers,
  useMockupHtml,
  useMockupLayers,
} from "@/lib/yjs/react"
import { workspaceLabel } from "@/lib/workspace-label"

/** The kinds of layer a chat names. */
export type LayerMentionKind = "mockup" | "frame" | "document"

const KIND_LABEL: Record<LayerMentionKind, string> = {
  mockup: "Mockup",
  frame: "Frame",
  document: "Document",
}

/** The card's inner width: `w-64` less its `p-2.5` on each side. */
const PREVIEW_WIDTH = 236
/** The tallest a preview gets; a tall page shows its top. */
const PREVIEW_MAX_HEIGHT = 160

// The card portals out of the message while React events still bubble
// through it: keep its clicks from reaching the message or the canvas.
const stop = (e: SyntheticEvent) => e.stopPropagation()

/**
 * The hover card on a Mockup, frame or document a chat message names: a
 * preview of the layer, its name and kind, then its chat and size, and Open
 * chat. Opens after the same deliberate pause as the chat hover card, and
 * reads the canvas only while open. A layer that's gone says so.
 */
export function LayerHoverCard({
  kind,
  id,
  children,
}: {
  kind: LayerMentionKind
  id: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <HoverCard
      open={open}
      onOpenChange={setOpen}
      openDelay={WORKSPACE_HOVER_CARD_DELAY_MS}
    >
      <HoverCardTrigger asChild onPointerDown={() => setOpen(false)}>
        {children}
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="start"
        className="w-64"
        data-testid="layer-hover-card"
        onClick={stop}
        onPointerDown={stop}
      >
        <LayerHoverDetail
          kind={kind}
          id={id}
          onOpenChat={() => setOpen(false)}
        />
      </HoverCardContent>
    </HoverCard>
  )
}

type Layer = {
  id: string
  title: string
  width: number
  height: number
  chat?: { label: string; open: () => void }
  rows: [string, string][]
}

/** The named layer as the card shows it, or null when it's gone. */
function useNamedLayer(kind: LayerMentionKind, id: string): Layer | null {
  const frames = useIframeLayers()
  const documents = useMarkdownLayers()
  const mockups = useMockupLayers()
  const branches = useBranches()
  const chats = useChatSessions()
  const menu = useChatsMenu()

  const workspaceChat = (branchId: string | undefined) => {
    const branch = branchId && branches.find((b) => b.id === branchId)
    if (!branch) return undefined
    return {
      label: workspaceLabel(branch),
      open: () => menu?.onSelectWorkspace(branch.id),
    }
  }
  const chatOf = (layer: Parameters<typeof lastChangedBy>[0]) => {
    const owner = layerChat(lastChangedBy(layer), chats)
    if (!owner) return undefined
    if (owner.kind === "workspace") return workspaceChat(owner.branchId)
    const chat = chats.find((c) => c.id === owner.chatId)
    return chat
      ? { label: chat.label, open: () => menu?.onSelectSketchChat(chat.id) }
      : undefined
  }
  const size = (l: { width: number; height: number }) =>
    `${Math.round(l.width)} × ${Math.round(l.height)}`

  if (kind === "frame") {
    const frame = frames.find((f) => f.id === id)
    if (!frame) return null
    const chat = workspaceChat(frame.branchId)
    return {
      id,
      title: frame.label || "Untitled frame",
      width: frame.width,
      height: frame.height,
      chat,
      rows: [
        ...(chat ? [["Chat", chat.label] as [string, string]] : []),
        ...(frame.route ? [["Page", frame.route] as [string, string]] : []),
        ["Size", size(frame)],
      ],
    }
  }
  const layer =
    kind === "mockup"
      ? mockups.find((m) => m.id === id)
      : documents.find((d) => d.id === id)
  if (!layer) return null
  const chat = chatOf(layer)
  return {
    id,
    title: layer.title || KIND_LABEL[kind],
    width: layer.width,
    height: layer.height,
    chat,
    rows: [
      ...(chat
        ? [
            [kind === "document" ? "Edited by" : "Chat", chat.label] as [
              string,
              string,
            ],
          ]
        : []),
      ...(kind === "mockup" ? [["Size", size(layer)] as [string, string]] : []),
    ],
  }
}

function LayerHoverDetail({
  kind,
  id,
  onOpenChat,
}: {
  kind: LayerMentionKind
  id: string
  onOpenChat: () => void
}) {
  const layer = useNamedLayer(kind, id)
  const menu = useChatsMenu()
  const body = useDocumentBody(kind === "document" ? id : null)
  if (!layer) {
    return (
      <p className="text-sm text-muted-foreground">
        This {KIND_LABEL[kind].toLowerCase()} was deleted.
      </p>
    )
  }
  const rows: [string, string][] = body
    ? [...layer.rows, ["Length", lineCount(body)]]
    : layer.rows
  return (
    <>
      {kind === "mockup" ? (
        <MockupPreview layer={layer} />
      ) : kind === "frame" ? (
        <FramePreview layer={layer} />
      ) : (
        <DocumentPreview body={body} />
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium break-words">{layer.title}</p>
        <p className="text-sm text-muted-foreground">{KIND_LABEL[kind]}</p>
      </div>
      {rows.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {rows.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {layer.chat && menu && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onOpenChat()
            layer.chat?.open()
          }}
        >
          Open chat
        </Button>
      )}
    </>
  )
}

/** The preview's box: the layer's shape at the card's width, its top when tall. */
function previewBox(layer: { width: number; height: number }) {
  const scale = PREVIEW_WIDTH / Math.max(layer.width, 1)
  return {
    scale,
    height: Math.min(Math.round(layer.height * scale), PREVIEW_MAX_HEIGHT),
  }
}

const PREVIEW_CLASS =
  "relative shrink-0 overflow-hidden rounded-md bg-background ring-1 ring-foreground/10"

/**
 * A Mockup's page, live, at the card's width: the same sandboxed document its
 * layer shows (`mockupSrcDoc`), scaled down and inert.
 */
function MockupPreview({ layer }: { layer: Layer }) {
  const html = useMockupHtml(layer.id)
  const runtime = useMockupRuntime()
  const resources = useMockupRefs(layer.id, html)
  const srcDoc = useMemo(
    () =>
      html.trim() && runtime !== null && resources !== null
        ? mockupSrcDoc(html, runtime, resources)
        : undefined,
    [html, runtime, resources]
  )
  if (!html.trim()) return null
  const { scale, height } = previewBox(layer)
  return (
    <div data-slot="layer-preview" className={PREVIEW_CLASS} style={{ height }}>
      {srcDoc !== undefined && (
        <iframe
          title={layer.title}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
          style={{
            width: layer.width,
            height: height / scale,
            transform: `scale(${scale})`,
          }}
        />
      )}
    </div>
  )
}

/**
 * A frame's last capture, the one the home grid shows. None before the page
 * was first captured, so the card starts at the name.
 */
function FramePreview({ layer }: { layer: Layer }) {
  const roomId = useRoomId()
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    getRoomThumbnailManifest(roomId)
      .then((manifest) => {
        const capture = manifest?.frames.find((f) => f.id === layer.id)?.capture
        if (!cancelled) setUrl(capture?.url ?? null)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [roomId, layer.id])
  if (!url) return null
  const { height } = previewBox(layer)
  return (
    <div data-slot="layer-preview" className={PREVIEW_CLASS} style={{ height }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- a stored capture, sized here */}
      <img src={url} alt="" className="size-full object-cover object-top" />
    </div>
  )
}

/** A Document's body as markdown, below its title; null for no Document. */
function useDocumentBody(id: string | null): string {
  const { doc } = useYjs()
  return useMemo(
    () => (id ? readDocumentBody(documentFragment(doc, id)).trim() : ""),
    [doc, id]
  )
}

function lineCount(body: string): string {
  const lines = body.split("\n").filter((l) => l.trim()).length
  return lines === 1 ? "1 line" : `${lines} lines`
}

/** A Document's opening lines, as it reads, fading out at the bottom. */
function DocumentPreview({ body }: { body: string }) {
  if (!body) return null
  return (
    <div
      data-slot="layer-preview"
      className={`${PREVIEW_CLASS} max-h-28 [mask-image:linear-gradient(#000_70%,transparent)] px-3 py-2 [&_.chat-markdown>:first-child]:mt-0`}
    >
      <ChatMarkdown tone="muted" size="xs">
        {body.slice(0, 600)}
      </ChatMarkdown>
    </div>
  )
}
