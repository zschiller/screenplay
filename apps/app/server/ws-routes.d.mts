export type WsRouteName = "yjs" | "terminal"

export declare const WS_ROUTES: Record<WsRouteName, string>

export declare function setLocalWsPort(name: WsRouteName, port: number): void

export declare function localWsPort(name: WsRouteName): number | undefined

export declare function matchWsRoute(
  url: string
): { name: WsRouteName; path: string } | null

/** A checked viewer upgrade the local Yjs server takes over. */
export type ViewerYjsAccept = (
  req: import("node:http").IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer,
  viewer: {
    roomId: string
    person: import("@/lib/viewer-identity/types").ViewerPerson
  }
) => void

export declare function setViewerYjs(accept: ViewerYjsAccept | undefined): void

export declare function viewerYjs(): ViewerYjsAccept | undefined

export declare function setViewerYjsClose(
  close: (() => Promise<void>) | undefined
): void

export declare function closeViewerYjs(): Promise<void>

export declare const SHARING_OFF_CLOSE_CODE: 4001
export declare const SHARING_OFF_REASON: "sharing off"
