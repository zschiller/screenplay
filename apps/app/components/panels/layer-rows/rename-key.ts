import type { KeyboardEvent, RefObject } from "react"
import type { EditableTextHandle } from "@workspace/ui/components/editable-text"

/** A sidebar row is one Tab stop: its button. Its name isn't a stop of its
 *  own, so F2 on the button renames, the keyboard twin of double-clicking
 *  the name (H9). */
export function renameOnF2(
  e: KeyboardEvent<HTMLElement>,
  editableRef: RefObject<EditableTextHandle | null> | undefined
) {
  if (e.key !== "F2" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return
  e.preventDefault()
  e.stopPropagation()
  editableRef?.current?.startEditing()
}
