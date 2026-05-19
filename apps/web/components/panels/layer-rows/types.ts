import type { ComponentType } from "react"

/**
 * Per-kind sidebar row component contract. Each layer kind ships exactly
 * one of these — a `LayerRow` rendering one item, plus an optional
 * `LayerRowMenu` providing the dropdown actions (rename/delete/etc).
 *
 * The sidebar's group-list dispatcher walks group members and renders
 * the row for `member.kind` with a kind-specific resolver pulling the
 * underlying data out of the right collection. Adding a new layer kind
 * means writing one of these and registering it — the dispatcher itself
 * never enumerates kinds.
 */
export interface LayerRowComponents<T> {
  kind: string
  Row: ComponentType<LayerRowProps<T>>
  Menu: ComponentType<LayerRowMenuProps<T>>
}

export interface LayerRowProps<T> {
  item: T
  /** "flat" for single-member groups, "sub" for nested rows under a folder. */
  variant: "flat" | "sub"
  selected: boolean
  onSelect: (id: string, shiftKey: boolean) => void
  /** Optional double-click activation (e.g. zoom-to-frame). Suppressed when
   *  the user is double-clicking the name to inline-rename. */
  onActivate?: (id: string) => void
  /** Inline rename triggered by double-clicking the row's name. */
  onRename: (id: string, name: string) => void
}

export interface LayerRowMenuProps<T> {
  item: T
  isSub: boolean
  onRename: (id: string, name: string) => void
  onChangeRoute?: (id: string, route: string) => void
  onRemove: (id: string) => void
}
