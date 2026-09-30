/**
 * Where a canvas keystroke landed, read from its event target. The canvas
 * keyboard handler listens on `window`, so every key pressed anywhere in the
 * page reaches it; these checks decide which of those keys are the canvas's.
 *
 * Kept DOM-only (no React) so the rules can be asserted on bare elements.
 */

/** An input, textarea, select or contenteditable: the key types text. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (target instanceof HTMLElement && target.isContentEditable) return true
  return !!target.closest(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])'
  )
}

/**
 * Inside an open menu, dialog, popover or listbox. Radix puts focus in the
 * content it opens, so keys pressed while one is open land here: they belong to
 * it, not to the frame selected behind it.
 */
export function isInOverlay(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !!target.closest(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'
  )
}

/**
 * The chat composer. Chat is plain text on the wire, so it has no bold or
 * italic of its own and the ⌘I chat toggle still works from it.
 */
export const COMPOSER_ATTRIBUTE = "data-composer"

export function isInComposer(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return !!target.closest(`[${COMPOSER_ATTRIBUTE}]`)
}

const CONTROLS =
  'button, a[href], summary, [role="button"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="switch"], [role="radio"], [role="option"]'

/**
 * A control focused from the keyboard, where Space presses it. A control that
 * merely kept focus after a click doesn't count, so holding Space still pans
 * after using the toolbar.
 */
export function isKeyboardFocusedControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  if (!target.closest(CONTROLS)) return false
  try {
    return target.matches(":focus-visible")
  } catch {
    return false
  }
}

/** ⌘ on a Mac, Ctrl everywhere else; either one counts, as undo already does. */
export function hasModKey(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.metaKey || e.ctrlKey
}

/**
 * Where a key landed, as bare data: the four facts the Canvas Shortcut table
 * gates on. Read once per keydown so the matcher stays DOM-free.
 */
export interface KeyTarget {
  /** In an input, textarea, select or contenteditable ({@link isTextEntry}). */
  textEntry: boolean
  /** In the chat composer ({@link isInComposer}). */
  composer: boolean
  /** In an open menu, dialog or listbox ({@link isInOverlay}). */
  overlay: boolean
  /** On a control focused from the keyboard ({@link isKeyboardFocusedControl}). */
  keyboardControl: boolean
}

export function keyTargetOf(target: EventTarget | null): KeyTarget {
  return {
    textEntry: isTextEntry(target),
    composer: isInComposer(target),
    overlay: isInOverlay(target),
    keyboardControl: isKeyboardFocusedControl(target),
  }
}
