export type WsRouteName = "yjs" | "terminal"

export declare const WS_ROUTES: Record<WsRouteName, string>

export declare function setLocalWsPort(name: WsRouteName, port: number): void

export declare function localWsPort(name: WsRouteName): number | undefined

export declare function matchWsRoute(
  url: string
): { name: WsRouteName; path: string } | null
