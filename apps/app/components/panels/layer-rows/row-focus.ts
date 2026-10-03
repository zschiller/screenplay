import { useCallback, useRef } from "react"

/** The button that selects a sidebar row: its one Tab stop and its keyboard
 *  drag handle. The row's … menu is a `menu-action`, not matched here. */
export const ROW_BUTTON_SELECTOR =
  ":scope > [data-sidebar=menu-button], :scope > [data-sidebar=menu-sub-button]"

/** Marks each Canvas list row: "group" on a Group header, "row" on a flat row
 *  or a Group member. */
export const ROW_ATTRIBUTE = "data-sidebar-row"

/**
 * The row button focus should land on once the row holding `from` is deleted:
 * the next row, else the previous one. A Group header takes its members with
 * it, so they're skipped. Null when the list has nothing else.
 */
export function neighbourRowButton(from: Element): HTMLElement | null {
  const row = from.closest(`[${ROW_ATTRIBUTE}]`)
  if (!row) return null
  const gone =
    (row.getAttribute(ROW_ATTRIBUTE) === "group" &&
      row.closest("[data-sidebar=menu-item]")) ||
    row
  const list = row.ownerDocument.querySelectorAll(`[${ROW_ATTRIBUTE}]`)
  let before: Element | null = null
  let after: Element | null = null
  for (const candidate of list) {
    if (gone.contains(candidate)) continue
    const position = gone.compareDocumentPosition(candidate)
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
      after = candidate
      break
    }
    before = candidate
  }
  const next = after ?? before
  return next?.querySelector<HTMLElement>(ROW_BUTTON_SELECTOR) ?? null
}

/**
 * Delete from a row's … menu, then focus its neighbour rather than dropping
 * focus to the page with the gone row's trigger. The neighbour is found when
 * the menu opens; when the menu's close finds its trigger gone, the row was
 * deleted, so focus moves there. `triggerRef` goes on the menu's trigger,
 * `onOpenChange` on the menu, `onCloseAutoFocus` on its content.
 */
export function useFocusNeighbourOnDelete() {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const neighbourRef = useRef<HTMLElement | null>(null)
  const onOpenChange = useCallback((open: boolean) => {
    if (open && triggerRef.current) {
      neighbourRef.current = neighbourRowButton(triggerRef.current)
    }
  }, [])
  const onCloseAutoFocus = useCallback((e: Event) => {
    const next = neighbourRef.current
    neighbourRef.current = null
    if (triggerRef.current?.isConnected || !next?.isConnected) return
    e.preventDefault()
    next.focus()
  }, [])
  return { triggerRef, onOpenChange, onCloseAutoFocus }
}
