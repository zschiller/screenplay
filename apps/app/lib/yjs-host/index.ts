import "server-only"

import { getLiveblocksHost } from "@/lib/yjs-host/liveblocks-server"
import type { YjsHost } from "@/lib/yjs-host/types"

export type {
  YjsHost,
  RoomMemberInput,
  IssueTokenInput,
  IssueTokenResult,
} from "@/lib/yjs-host/types"

/**
 * The configured Yjs host singleton. Today this is always Liveblocks; making
 * it an env-switched factory is a one-line change once a second
 * implementation lands.
 */
export const yjsHost: YjsHost = getLiveblocksHost()
