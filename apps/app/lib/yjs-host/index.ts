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
 * Resolve the configured host. Build-time switch: the desktop build sets
 * `NEXT_PUBLIC_YJS_HOST=local` to select the local, disk-persisted y-websocket
 * host; unset (the hosted deployment) keeps Liveblocks unchanged. The matching
 * client surface flips on the same flag in `client.tsx`.
 */
function resolveYjsHost(): YjsHost {
  return process.env.NEXT_PUBLIC_YJS_HOST === "local"
    ? getLocalYjsHost()
    : getLiveblocksHost()
}

let resolved: YjsHost | null = null
function host(): YjsHost {
  return (resolved ??= resolveYjsHost())
}

/**
 * The configured Yjs host singleton, resolved **lazily on first use**.
 *
 * Resolving the Liveblocks host reads `LIVEBLOCKS_SECRET_KEY` and throws when
 * it's unset (see {@link getLiveblocksHost}). Resolving eagerly at module load
 * therefore made the *entire* server import graph that transitively reaches
 * here unloadable wherever the secret is absent — unit tests above all — where
 * the throw surfaced as an async unhandled rejection whose appearance depended
 * on worker scheduling (a flaky CI failure). Deferring to first property access
 * keeps production behavior identical: the first real `yjsHost.*` call still
 * throws if the host is misconfigured. The Proxy forwards every access to the
 * resolved host and binds methods so `this` stays correct.
 */
export const yjsHost: YjsHost = new Proxy({} as YjsHost, {
  get(_target, prop, receiver) {
    const target = host()
    const value = Reflect.get(target, prop, receiver)
    return typeof value === "function" ? value.bind(target) : value
  },
})
