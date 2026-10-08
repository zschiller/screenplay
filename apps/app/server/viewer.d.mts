import type { IncomingMessage } from "node:http"

import type {
  ViewerAnswer,
  ViewerIdentity,
  ViewerPerson,
  ViewerRequest,
} from "@/lib/viewer-identity/types"

export declare const VIEWER_HEADER: "x-screenplay-viewer"
export declare const REFUSAL_HEADER: "x-screenplay-viewer-refusal"
export declare const REFUSED_PATH: "/viewer-refused"
export declare const BROKEN_LOOKUP_MESSAGE: string

export declare function stripReservedHeaders(req: IncomingMessage): void
export declare function setReservedHeader(
  req: IncomingMessage,
  name: string,
  value: unknown
): void
export declare function encodeHeaderValue(value: unknown): string
export declare function decodeHeaderValue(
  value: string | null | undefined
): unknown

export declare function setViewerIdentity(
  id: string,
  identity: ViewerIdentity | null
): void
export declare function getViewerIdentity(): ViewerIdentity | undefined

export declare function createIdentifier(opts?: {
  identity?: () => ViewerIdentity | undefined
  now?: () => number
  log?: (line: string) => void
  maxEntries?: number
}): (request: ViewerRequest) => Promise<ViewerAnswer>

export type { ViewerPerson }
