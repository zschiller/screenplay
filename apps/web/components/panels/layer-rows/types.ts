import type { ComponentType, RefObject } from "react"
import type { EditableTextHandle } from "@workspace/ui/components/editable-text"

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
  /** Forwarded to the row's inline-rename input so the Menu's "Rename" item
   *  can flip the row into edit mode in place instead of opening a prompt. */
  editableRef?: RefObject<EditableTextHandle | null>
}

export interface LayerRowMenuProps<T> {
  item: T
  isSub: boolean
  onRename: (id: string, name: string) => void
  onRemove: (id: string) => void
  /** Shared with the matching Row — clicking "Rename" calls `startEditing()`
   *  to put the row's name into inline edit mode. */
  editableRef?: RefObject<EditableTextHandle | null>
}
