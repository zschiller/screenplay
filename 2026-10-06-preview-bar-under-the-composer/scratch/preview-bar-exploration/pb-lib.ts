import { WebsocketProvider } from "y-websocket"
import * as Y from "yjs"
import WebSocket from "ws"
import type { Page } from "playwright-core"
import type { BranchData } from "@/lib/types"
import { getRoomCollections } from "@/lib/yjs/schema"
import { resolveCaptureProfile } from "../../profile"

export async function peer(roomId: string) {
  const port = Number(process.env.NEXT_PUBLIC_YJS_WS_PORT ?? 1234)
  const { baseUrl } = resolveCaptureProfile()
  const res = await fetch(`${baseUrl}/api/yjs/auth`, { method: "POST" })
  const { token } = (await res.json()) as { token: string }
  class W extends WebSocket {
    constructor(url: string, protocols?: string | string[]) { super(url, protocols, { origin: baseUrl }) }
  }
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(`ws://127.0.0.1:${port}`, roomId, doc, { WebSocketPolyfill: W as never, disableBc: true, params: { token } })
  await new Promise<void>((r) => provider.once("sync", () => r()))
  const branches = getRoomCollections(doc).branches
  return {
    get: (id: string) => branches.get(id),
    patch: (id: string, v: Partial<BranchData>) => branches.update(id, v),
    close: () => { provider.destroy(); doc.destroy() },
  }
}

/** Bounding boxes of the composer box and the footnote's pieces. */
export async function measure(page: Page) {
  return page.evaluate(`(() => {
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), r: +(b.right).toFixed(1), b: +(b.bottom).toFixed(1) } }
    const composers = [...document.querySelectorAll('[data-slot=composer]')].filter((e) => e.offsetParent)
    const composer = composers[composers.length - 1]
    const group = composer?.querySelector('[data-slot=input-group]')
    const tablist = [...document.querySelectorAll('[aria-label=Terminals]')].find((e) => e.offsetParent)
    const pane = tablist?.closest('[data-pane]')
    const tab = tablist?.querySelector('[role=tab]')
    const label = tab?.querySelector('span')
    const dot = tab?.querySelector('[data-dev-server-state]')
    const btn = pane ? [...pane.querySelectorAll('button')].find((b) => /Stop|Run/.test(b.textContent || "")) : null
    const panel = pane?.closest('[data-panel]')?.parentElement
    const placeholder = composer?.querySelector('.tiptap p, .tiptap')
    const cs = tab ? getComputedStyle(tab) : null
    return { panel: r(panel ?? null), composer: r(composer ?? null), group: r(group ?? null), placeholder: r(placeholder ?? null), pane: r(pane ?? null), tab: r(tab ?? null), label: r(label ?? null), dot: r(dot ?? null), btn: r(btn ?? null), btnSvg: r(btn?.querySelector('svg') ?? null), tabFont: cs && \`\${cs.fontSize} \${cs.color}\` }
})()`) as Promise<any>
}
