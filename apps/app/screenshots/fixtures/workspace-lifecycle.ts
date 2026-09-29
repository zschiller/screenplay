import { WebsocketProvider } from "y-websocket"
import * as Y from "yjs"
import WebSocket from "ws"

import type { BranchData } from "@/lib/types"
import { getRoomCollections } from "@/lib/yjs/schema"

import { resolveCaptureProfile } from "../profile"
import { COLD_WORKSPACE_PREFIX, previewDomainFor } from "../lib/preview-url"
import { FIXTURE_IDS } from "./world"

/**
 * Walk the Frame states Canvas's recording Workspace through its lifecycle
 * while a video runs (issue #731): booting, then starting, then running on a
 * preview that answers. The fixture world has no sandbox to do it, so this
 * writes the status straight into the room's Y.Doc as a peer, which is exactly
 * how a real provision reaches the page.
 *
 * {@link reset} puts it back to `creating` behind a cold preview, so a capture
 * run after a recording still finds the seeded state.
 */
export interface WorkspaceLifecycle {
  patch: (patch: Partial<BranchData>) => void
  reset: () => void
  close: () => void
}

const ROOM_ID = FIXTURE_IDS.rooms.frameStates
const BRANCH_ID = FIXTURE_IDS.branches.framesLive

export async function connectWorkspaceLifecycle(): Promise<WorkspaceLifecycle> {
  // The app's y-websocket server; the port matches `yjsWebsocketPort()`.
  const port = Number(process.env.NEXT_PUBLIC_YJS_WS_PORT ?? 1234)
  const { baseUrl, previewOrigin } = resolveCaptureProfile()
  // The server only accepts the app's own Origin carrying the per-launch token
  // the app hands its webview (#997), so join the way the page does.
  const res = await fetch(`${baseUrl}/api/yjs/auth`, { method: "POST" })
  if (!res.ok) throw new Error(`yjs auth failed: ${res.status}`)
  const { token } = (await res.json()) as { token: string }
  class AppOriginWebSocket extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { origin: baseUrl })
    }
  }
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(
    `ws://127.0.0.1:${port}`,
    ROOM_ID,
    doc,
    {
      WebSocketPolyfill: AppOriginWebSocket as never,
      disableBc: true,
      params: { token },
    }
  )
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out joining the Frame states room")),
      15_000
    )
    provider.once("sync", () => {
      clearTimeout(timer)
      resolve()
    })
  })
  const branches = getRoomCollections(doc).branches
  const patch = (value: Partial<BranchData>) =>
    branches.update(BRANCH_ID, value)
  return {
    patch,
    reset: () =>
      patch({
        status: "creating",
        statusMessage: "Cloning repository…",
        previewDomain: previewDomainFor(
          previewOrigin,
          `${COLD_WORKSPACE_PREFIX}live`
        ),
      }),
    close: () => {
      provider.destroy()
      doc.destroy()
    },
  }
}

/** The preview a warmed-up recording Workspace serves: a page, not the placeholder. */
export function livePreviewDomain(): string {
  return previewDomainFor(
    resolveCaptureProfile().previewOrigin,
    "agent-profile"
  )
}
