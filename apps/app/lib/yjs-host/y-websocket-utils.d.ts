/**
 * Minimal typings for `y-websocket`'s server helper (`bin/utils.cjs`), which
 * ships without its own declarations. We use the subset the local Yjs host
 * needs: the shared doc registry, doc accessor, connection setup, and the
 * pluggable persistence hook.
 */
declare module "y-websocket/bin/utils" {
  import type { IncomingMessage } from "node:http"
  import type { WebSocket } from "ws"
  import type * as Y from "yjs"

  /** A `Y.Doc` augmented by y-websocket with connection bookkeeping. */
  export interface WSSharedDoc extends Y.Doc {
    name: string
    conns: Map<WebSocket, Set<number>>
    awareness: unknown
  }

  export interface Persistence {
    bindState(docName: string, ydoc: WSSharedDoc): void | Promise<void>
    writeState(docName: string, ydoc: WSSharedDoc): Promise<unknown>
    provider?: unknown
  }

  /** The process-wide registry of live docs, keyed by room id. */
  export const docs: Map<string, WSSharedDoc>

  export function getYDoc(docname: string, gc?: boolean): WSSharedDoc

  export function setupWSConnection(
    conn: WebSocket,
    req: IncomingMessage,
    opts?: { docName?: string; gc?: boolean }
  ): void

  export function setPersistence(persistence: Persistence | null): void

  export function getPersistence(): Persistence | null
}
