import type { ComponentType } from "react"

/**
 * Per-kind descriptor for canvas layers (frames, documents, future kinds
 * like sticky notes / images / embeds). The sidebar list and any other
 * surface that displays "a layer" generically reads its UI hooks from here, so
 * adding a new kind is:
 *
 *   1. Add a new entry to `GroupMemberKind` in `lib/types.ts`.
 *   2. Add a Yjs collection + migration step in `lib/yjs/schema.ts`.
 *   3. Add a width/height resolver case in `lib/canvas/layout.ts`.
 *   4. Build the canvas component (mirror `MarkdownLayer`).
 *   5. Wire that component into the canvas's group-render switch.
 *   6. Ship a `LayerKindDescriptor` and register it in `LAYER_KINDS`.
 *
 * Steps 4–6 are the only ones that touch UI code; the dispatchers in the
 * sidebar don't need to know about specific kinds.
 *
 * `<T>` is the concrete data shape for the kind (e.g. `IframeLayerData`,
 * `MarkdownLayerData`).
 */
export interface LayerKindDescriptor<T = unknown> {
  /** Discriminator. Must match `GroupMember.kind`. */
  kind: string
  /** Plural section heading: "Frames", "Documents". */
  pluralLabel: string
  /** Singular noun: "frame", "document". */
  singularLabel: string
  /** Icon used in sidebar rows. */
  Icon: ComponentType<{ className?: string }>
  /** Display label for an item (sidebar row text). */
  getLabel: (item: T) => string
}
