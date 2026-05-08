import type { LayerKindDescriptor } from "./types"
import { artboardKind } from "./artboard"
import { documentKind } from "./document"

export type { LayerKindDescriptor } from "./types"
export { artboardKind, documentKind }

/**
 * Erased descriptor type — opaque payload type so the registry can hold a
 * heterogeneous list of kinds without callers needing to know each kind's
 * concrete data type. Per-kind modules export the typed descriptor; the
 * registry just stores the erased view.
 */
type AnyLayerKindDescriptor = LayerKindDescriptor<never>

/**
 * Every registered layer kind. Order matters for default rendering order —
 * picker sections, sidebar default sort, etc. Add a new entry here when
 * you ship a new kind; the central dispatchers (sidebar, picker, target
 * pill) iterate this array rather than enumerating kinds inline.
 */
export const LAYER_KINDS: ReadonlyArray<AnyLayerKindDescriptor> = [
  artboardKind as unknown as AnyLayerKindDescriptor,
  documentKind as unknown as AnyLayerKindDescriptor,
]

const KIND_BY_KEY = new Map<string, AnyLayerKindDescriptor>(
  LAYER_KINDS.map((k) => [k.kind, k]),
)

/** Lookup helper. Returns `undefined` for unregistered kinds — callers
 *  should treat missing kinds as a "skip render" rather than crash. */
export function getLayerKind(kind: string): AnyLayerKindDescriptor | undefined {
  return KIND_BY_KEY.get(kind)
}

/** Subset that can be selected as a chat target. */
export const CHAT_TARGETABLE_LAYER_KINDS: ReadonlyArray<AnyLayerKindDescriptor> =
  LAYER_KINDS.filter((k) => k.canBeChatTarget)
