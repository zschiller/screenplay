import "server-only"

import { getLiveblocksHost } from "@/lib/yjs-host/liveblocks-server"
import { getLocalYjsHost } from "@/lib/yjs-host/y-websocket-server"
import type { YjsHost } from "@/lib/yjs-host/types"

export type {
  YjsHost,
  RoomMemberInput,
  IssueTokenInput,
  IssueTokenResult,
} from "@/lib/yjs-host/types"

/**
 * The configured Yjs host singleton. Build-time switch: the desktop build sets
 * `NEXT_PUBLIC_YJS_HOST=local` to select the local, disk-persisted y-websocket
 * host; unset (the hosted deployment) keeps Liveblocks unchanged. The matching
 * client surface flips on the same flag in `client.tsx`.
 */
export const yjsHost: YjsHost =
  process.env.NEXT_PUBLIC_YJS_HOST === "local"
    ? getLocalYjsHost()
    : getLiveblocksHost()
