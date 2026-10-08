export declare const SHARE_PREFIX: "/s/"
export declare const SHARE_KEY_PARAM: "key"

export declare function shareKey(roomId: string, secret?: string): string | null
export declare function sharePath(
  roomId: string,
  secret?: string
): string | null
export declare function isShareKey(
  roomId: string,
  key: string | null | undefined,
  secret?: string
): boolean
export declare function parseSharePath(
  pathname: string
): { roomId: string; key: string; rest: string } | null
