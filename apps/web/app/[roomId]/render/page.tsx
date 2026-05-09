import { notFound } from "next/navigation"
import * as Y from "yjs"
import { getRoom } from "@/lib/rooms"
import { verifyRenderToken } from "@/lib/thumbnail/token"
import { readRoomDoc } from "@/lib/yjs/server"
import { computeIframeLayerLayouts } from "@/lib/iframe-layer-layout"
import { RenderCanvas } from "./render-canvas"
import type { RenderIframeLayer } from "./render-canvas"

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function renderXmlText(text: Y.XmlText): string {
  const delta = text.toDelta() as Array<{
    insert?: string
    attributes?: Record<string, unknown>
  }>
  return delta
    .map(({ insert, attributes }) => {
      if (typeof insert !== "string") return ""
      let html = escapeHtml(insert)
      if (!attributes) return html
      if (attributes.code) html = `<code>${html}</code>`
      if (attributes.strike) html = `<s>${html}</s>`
      if (attributes.italic) html = `<em>${html}</em>`
      if (attributes.bold) html = `<strong>${html}</strong>`
      return html
    })
    .join("")
}

function renderXmlChildren(node: Y.XmlFragment | Y.XmlElement): string {
  const out: string[] = []
  const len = node.length
  for (let i = 0; i < len; i++) {
    const child = node.get(i)
    if (child instanceof Y.XmlText) {
      out.push(renderXmlText(child))
    } else if (child instanceof Y.XmlElement) {
      out.push(renderXmlElement(child))
    }
  }
  return out.join("")
}

function renderXmlElement(el: Y.XmlElement): string {
  const children = renderXmlChildren(el)
  switch (el.nodeName) {
    case "paragraph":
      return `<p>${children}</p>`
    case "heading": {
      const raw = Number(el.getAttribute("level") ?? 1)
      const level = Math.min(6, Math.max(1, Number.isFinite(raw) ? raw : 1))
      return `<h${level}>${children}</h${level}>`
    }
    case "bulletList":
      return `<ul>${children}</ul>`
    case "orderedList":
      return `<ol>${children}</ol>`
    case "listItem":
      return `<li>${children}</li>`
    case "blockquote":
      return `<blockquote>${children}</blockquote>`
    case "codeBlock":
      return `<pre><code>${children}</code></pre>`
    case "hardBreak":
      return `<br/>`
    case "horizontalRule":
      return `<hr/>`
    default:
      return children
  }
}

function fragmentToHtml(fragment: Y.XmlFragment): string {
  return renderXmlChildren(fragment)
}

export const dynamic = "force-dynamic"

export default async function RenderPage({
  params,
  searchParams,
}: {
  params: Promise<{ roomId: string }>
  searchParams: Promise<{ token?: string }>
}) {
  const { roomId } = await params
  const { token } = await searchParams

  if (!token || !verifyRenderToken(roomId, token)) notFound()

  const room = await getRoom(roomId)
  if (!room) notFound()

  const { iframeLayers, markdownLayers } = await readRoomDoc(roomId, (c) => {
    const agents = c.agents.toMap()
    const allIframeLayers = c.iframeLayers.toArray()
    const allDocuments = c.markdownLayers.toArray()
    const allGroups = c.iframeLayerGroups.toArray()
    const layouts = computeIframeLayerLayouts(allGroups, allIframeLayers, allDocuments)
    const arts: RenderIframeLayer[] = allIframeLayers.flatMap((a) => {
      const layout = layouts.get(a.id)
      if (!layout) return []
      const agent = a.sandboxId ? agents.get(a.sandboxId) : undefined
      const previewDomain = agent?.previewDomain
      return [{
        id: a.id,
        x: layout.x,
        y: layout.y,
        width: a.width,
        height: a.height,
        label: a.label,
        iframeUrl: previewDomain
          ? previewDomain + (a.route ?? "")
          : null,
      }]
    })
    const docs = allDocuments.flatMap((d) => {
      const layout = layouts.get(d.id)
      if (!layout) return []
      const fragment = c.doc.getXmlFragment(`markdown-layer-${d.id}`)
      return [{
        id: d.id,
        x: layout.x,
        y: layout.y,
        width: d.width,
        height: d.height,
        title: d.title || "",
        html: fragmentToHtml(fragment),
      }]
    })
    return { iframeLayers: arts, markdownLayers: docs }
  })

  return (
    <>
      <style>{`nextjs-portal { display: none !important; }`}</style>
      <RenderCanvas iframeLayers={iframeLayers} markdownLayers={markdownLayers} />
    </>
  )
}
